using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Net.Sockets;
using System.Windows.Forms;

internal sealed class ServerTray : ApplicationContext
{
    private const string ControlOrigin = "http://127.0.0.1:17837";
    private const string PipeName = "Zavod7.NativeServer.Tray";
    private readonly string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
    private readonly string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zavod7", "native-server");
    private readonly NotifyIcon icon;
    private readonly Control dispatcher = new Control();
    private readonly object ensureGate = new object();
    private Process child;
    private volatile bool exiting;
    private volatile bool mutationBusy;
    private volatile bool upgrading;
    private volatile bool upgradeAfterMutation;
    private string currentMutation;

    private ServerTray()
    {
        Directory.CreateDirectory(data);
        IntPtr unusedHandle = dispatcher.Handle;
        StartSignalListener();
        var menu = new ContextMenuStrip();
        menu.Items.Add("Открыть управление", null, delegate { OpenControl(); });
        menu.Items.Add("Сохранить и остановить мир", null, delegate { RunMutation("stop"); });
        menu.Items.Add("Запустить сервер", null, delegate { if (upgrading) return; if (EnsureServer()) OpenControl(); else ShowError("Не удалось запустить локальный сервер."); });
        menu.Items.Add("Остановить сервер", null, delegate { RunMutation("shutdown"); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Выход из панели", null, delegate { ExitTray(); });
        icon = new NotifyIcon { Icon = SystemIcons.Application, Text = "ЗАВОД-7 Dedicated Server", Visible = true, ContextMenuStrip = menu };
        icon.DoubleClick += delegate { OpenControl(); };
        EnsureServer();
    }

    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool created;
        using (var mutex = new Mutex(true, "Local\\Zavod7.NativeServer.Tray", out created))
        {
            var ownsMutex = created;
            if (!ownsMutex)
            {
                try { ownsMutex = mutex.WaitOne(0); }
                catch (AbandonedMutexException) { ownsMutex = true; }
                if (!ownsMutex)
                {
                    if (IsOpenRequest(args) && !SignalPrimary("open"))
                        MessageBox.Show("Панель уже запущена, но не ответила на запрос открытия.", "ЗАВОД-7", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
            }
            var tray = new ServerTray();
            if (IsOpenRequest(args)) tray.OpenControl();
            Application.Run(tray);
        }
    }

    private static bool IsOpenRequest(string[] args)
    {
        return args != null && args.Length == 1 && Regex.IsMatch(args[0], "^zavod7://server/?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    private static bool SignalPrimary(string command)
    {
        for (int attempt = 0; attempt < 30; attempt++)
        {
            try
            {
                using (var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out))
                {
                    pipe.Connect(250);
                    var bytes = Encoding.ASCII.GetBytes(command + "\n");
                    pipe.Write(bytes, 0, bytes.Length); pipe.Flush();
                    return true;
                }
            }
            catch (IOException) { Thread.Sleep(100); }
            catch (TimeoutException) { Thread.Sleep(100); }
        }
        return false;
    }

    private void StartSignalListener()
    {
        var listener = new Thread(delegate()
        {
            while (!exiting)
            {
                try
                {
                    string command;
                    var security = new PipeSecurity();
                    security.SetAccessRuleProtection(true, false);
                    security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.ReadWrite, AccessControlType.Allow));
                    security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
                    using (var pipe = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.None, 256, 256, security))
                    {
                        pipe.WaitForConnection();
                        using (var reader = new StreamReader(pipe, Encoding.ASCII)) command = reader.ReadLine();
                    }
                    if (command == "open") dispatcher.BeginInvoke((MethodInvoker)delegate { OpenControl(); });
                    else if (command == "exit") dispatcher.BeginInvoke((MethodInvoker)delegate { ExitTray(); });
                    else if (command == "upgrade") dispatcher.BeginInvoke((MethodInvoker)delegate { BeginUpgrade(); });
                }
                catch { if (!exiting) Thread.Sleep(100); }
            }
        });
        listener.IsBackground = true; listener.Name = "Zavod7 tray IPC"; listener.Start();
    }

    private string ControllerPath { get { return Path.Combine(data, "controller.json"); } }

    private bool ReadAuth(out string bearer, out string csrf)
    {
        bearer = csrf = "";
        try
        {
            var json = File.ReadAllText(ControllerPath, Encoding.UTF8);
            var m = Regex.Match(json, "\\\"controlAuth\\\"\\s*:\\s*\\{\\s*\\\"token\\\"\\s*:\\s*\\\"(?<token>[A-Za-z0-9_-]{32,128})\\\"\\s*,\\s*\\\"csrf\\\"\\s*:\\s*\\\"(?<csrf>[A-Za-z0-9_-]{32,128})\\\"");
            if (!m.Success) return false;
            bearer = m.Groups["token"].Value; csrf = m.Groups["csrf"].Value; return true;
        }
        catch { return false; }
    }

    private HttpWebRequest Request(string path, string method, string bearer, string csrf, string body, int timeout = 10000)
    {
        var request = (HttpWebRequest)WebRequest.Create(ControlOrigin + path);
        request.Method = method; request.Timeout = timeout; request.ReadWriteTimeout = timeout;
        request.Headers[HttpRequestHeader.Authorization] = "Bearer " + bearer;
        request.Headers["X-CSRF-Token"] = csrf;
        request.Headers["Origin"] = ControlOrigin;
        if (body != null)
        {
            var bytes = Encoding.UTF8.GetBytes(body); request.ContentType = "application/json"; request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
        }
        return request;
    }

    private bool AuthorizedGet(string path, string bearer, string csrf, out string response, int timeout = 10000)
    {
        response = "";
        try
        {
            using (var r = (HttpWebResponse)Request(path, "GET", bearer, csrf, null, timeout).GetResponse())
            using (var s = new StreamReader(r.GetResponseStream(), Encoding.UTF8)) { response = s.ReadToEnd(); return r.StatusCode == HttpStatusCode.OK; }
        }
        catch { return false; }
    }

    private bool EnsureServer()
    {
        lock (ensureGate)
        {
            string bearer, csrf, response;
            if (ReadAuth(out bearer, out csrf) && AuthorizedGet("/api/v1/status", bearer, csrf, out response, 2500)) return true;
            try
            {
                var node = Path.Combine(root, "dist", "native", "node.exe"); var server = Path.Combine(root, "dist", "native", "server.mjs");
                if (!File.Exists(node) || !File.Exists(server)) return false;
                var start = new ProcessStartInfo(node, "\"" + server + "\"") { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardOutput = true, RedirectStandardError = true };
                start.EnvironmentVariables["ZAVOD_DATA_DIR"] = data;
                child = Process.Start(start);
                if (child != null) { child.OutputDataReceived += delegate { }; child.ErrorDataReceived += delegate { }; child.BeginOutputReadLine(); child.BeginErrorReadLine(); }
            }
            catch { child = null; }
            for (int i = 0; i < 80; i++)
            {
                Thread.Sleep(250);
                if (ReadAuth(out bearer, out csrf) && AuthorizedGet("/api/v1/status", bearer, csrf, out response, 2500)) return true;
            }
            return false;
        }
    }

    private void OpenControl()
    {
        if (upgrading) return;
        if (!EnsureServer()) { ShowError("Не удалось запустить локальный сервер."); return; }
        string bearer, csrf, response;
        if (!ReadAuth(out bearer, out csrf)) { ShowError("Не удалось прочитать защищённые данные управления сервером."); return; }
        try
        {
            using (var r = (HttpWebResponse)Request("/api/v1/bootstrap-capability", "POST", bearer, csrf, "{}").GetResponse())
            using (var s = new StreamReader(r.GetResponseStream(), Encoding.UTF8)) response = s.ReadToEnd();
            var m = Regex.Match(response, "\\\"url\\\"\\s*:\\s*\\\"(?<url>http://127\\.0\\.0\\.1:[0-9]+/#local-admin=[A-Za-z0-9_-]+)\\\"");
            if (!m.Success) { ShowError("Сервер не выдал ссылку управления. Повторите через несколько секунд."); return; }
            Process.Start(new ProcessStartInfo(m.Groups["url"].Value) { UseShellExecute = true });
        }
        catch { ShowError("Не удалось открыть защищённую панель управления."); }
    }

    private void RunMutation(string path, bool exitAfterSuccess = false)
    {
        if (mutationBusy || (upgrading && !exitAfterSuccess)) { ShowError("Предыдущая операция ещё выполняется или сервер обновляется."); return; }
        mutationBusy = true;
        currentMutation = path;
        icon.Text = "ЗАВОД-7: выполняется сохранение";
        var worker = new Thread(delegate()
        {
            var error = Mutation(path);
            try
            {
                dispatcher.BeginInvoke((MethodInvoker)delegate
                {
                    mutationBusy = false;
                    icon.Text = "ЗАВОД-7 Dedicated Server";
                    if (upgradeAfterMutation)
                    {
                        upgradeAfterMutation = false;
                        if (currentMutation == "shutdown")
                        {
                            if (error == null) { ExitTray(); return; }
                            upgrading = false; ShowError(error); return;
                        }
                        RunMutation("shutdown", true); return;
                    }
                    if (exitAfterSuccess && error == null) { ExitTray(); return; }
                    if (exitAfterSuccess) upgrading = false;
                    if (error == null) MessageBox.Show(path == "stop" ? "Мир сохранён и остановлен." : "Сохранение завершено, сервер остановлен.", "ЗАВОД-7", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    else ShowError(error);
                });
            }
            catch (Exception e)
            {
                mutationBusy = false;
                try { MessageBox.Show("Не удалось показать результат операции: " + e.Message + ". Проверьте состояние сервера в панели.", "ЗАВОД-7", MessageBoxButtons.OK, MessageBoxIcon.Warning); } catch { }
            }
        });
        worker.IsBackground = true; worker.Name = "Zavod7 server mutation"; worker.Start();
    }

    private void BeginUpgrade()
    {
        if (upgrading) return;
        upgrading = true;
        if (mutationBusy) { upgradeAfterMutation = true; return; }
        RunMutation("shutdown", true);
    }

    private string Mutation(string path)
    {
        string bearer, csrf, status;
        if (!EnsureServer()) return "Не удалось связаться с сервером. Он не будет завершён принудительно.";
        if (!ReadAuth(out bearer, out csrf) || !AuthorizedGet("/api/v1/status", bearer, csrf, out status, 15000)) return "Не удалось подтвердить состояние сервера. Проверьте его панель управления.";
        var revision = Regex.Match(status, "\\\"revision\\\"\\s*:\\s*(?<n>[0-9]+)");
        if (!revision.Success) return "Ответ сервера не содержит версии состояния; операция не отправлена.";
        var requestId = Guid.NewGuid().ToString();
        var json = "{\"requestId\":\"" + requestId + "\",\"expectedRevision\":" + revision.Groups["n"].Value + "}";
        try
        {
            using (var response = (HttpWebResponse)Request("/api/v1/" + path, "POST", bearer, csrf, json, 300000).GetResponse())
            using (var stream = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                var body = stream.ReadToEnd();
                if (response.StatusCode != HttpStatusCode.OK || !Regex.IsMatch(body, "\\\"accepted\\\"\\s*:\\s*true") || !body.Contains(requestId)) return "Сервер не подтвердил операцию. Проверьте состояние в панели; сервер не был завершён принудительно.";
            }
            if (path == "shutdown" && !WaitForServerShutdown(bearer, csrf)) return "Сервер принял запрос, но остановка не подтверждена за пять минут. Панель оставлена открытой; проверьте состояние перед повтором.";
            return null;
        }
        catch (WebException e) { return "Не удалось получить подтверждение сохранения: " + e.Message + ". Проверьте состояние в панели; приложение не посылало принудительное завершение процесса."; }
        catch (Exception e) { return "Операция не подтверждена: " + e.Message + ". Проверьте состояние в панели."; }
    }

    private bool WaitForServerShutdown(string bearer, string csrf)
    {
        var deadline = DateTime.UtcNow.AddMinutes(5);
        while (DateTime.UtcNow < deadline)
        {
            string status;
            if (AuthorizedGet("/api/v1/status", bearer, csrf, out status, 3000) && Regex.IsMatch(status, "\\\"controller\\\"\\s*:\\s*\\{[^}]*\\\"state\\\"\\s*:\\s*\\\"stopped\\\"")) return true;
            if (ControlPortClosed()) return true;
            Thread.Sleep(500);
        }
        return false;
    }

    private static bool ControlPortClosed()
    {
        using (var client = new TcpClient())
        {
            try
            {
                var pending = client.BeginConnect("127.0.0.1", 17837, null, null);
                if (!pending.AsyncWaitHandle.WaitOne(1000)) { client.Close(); return false; }
                client.EndConnect(pending); return false;
            }
            catch (SocketException e) { return e.SocketErrorCode == SocketError.ConnectionRefused; }
            catch { return false; }
        }
    }

    private void ShowError(string message)
    {
        MessageBox.Show(message, "ЗАВОД-7", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    private void ExitTray()
    {
        if (mutationBusy) { ShowError("Дождитесь завершения сохранения перед закрытием панели."); return; }
        exiting = true; icon.Visible = false; icon.Dispose(); ExitThread();
    }

    protected override void ExitThreadCore() { if (!exiting) icon.Visible = false; base.ExitThreadCore(); }
}
