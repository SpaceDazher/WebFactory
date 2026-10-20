using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.IO.Pipes;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Setup
{
    private const string TrayMutexName = "Local\\Zavod7.NativeServer.Tray";
    private const string TrayPipeName = "Zavod7.NativeServer.Tray";
    private const string ControlOrigin = "http://127.0.0.1:17837";
    private const long MaxExpandedPayload = 2L * 1024 * 1024 * 1024;
    private const string ClassesPath = @"Software\Classes\zavod7";
    private const string CommandPath = @"Software\Classes\zavod7\shell\open\command";
    private const string RunPath = @"Software\Microsoft\Windows\CurrentVersion\Run";

    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            var running = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
            var root = InstallRoot();
            if (HasArg(args, "--apply"))
            {
                WaitForParent(args);
                Install(root, running);
            }
            else if (IsInside(running, Path.Combine(root, "dist")))
            {
                RelaunchOutsideInstall(running);
            }
            else Install(root, running);
        }
        catch (Exception e)
        {
            MessageBox.Show("Не удалось установить сервер: " + e.Message, "ЗАВОД-7", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string InstallRoot()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Zavod7");
    }

    private static bool HasArg(string[] args, string value)
    {
        foreach (var arg in args) if (String.Equals(arg, value, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static void RelaunchOutsideInstall(string running)
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "Zavod7-Setup");
        Directory.CreateDirectory(tempRoot);
        var copy = Path.Combine(tempRoot, "Zavod7-Server-Setup-" + Guid.NewGuid().ToString("N") + ".exe");
        File.Copy(running, copy, false);
        var start = new ProcessStartInfo(copy, "--apply --parentPid=" + Process.GetCurrentProcess().Id)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = tempRoot
        };
        Process.Start(start);
    }

    private static void WaitForParent(string[] args)
    {
        foreach (var arg in args)
        {
            if (!arg.StartsWith("--parentPid=", StringComparison.OrdinalIgnoreCase)) continue;
            int pid;
            if (!Int32.TryParse(arg.Substring("--parentPid=".Length), out pid) || pid <= 0) throw new InvalidOperationException("Invalid installer handoff process id.");
            try
            {
                using (var parent = Process.GetProcessById(pid))
                    if (!parent.WaitForExit(30000)) throw new InvalidOperationException("The previous installer copy is still running; no files were changed.");
            }
            catch (ArgumentException) { }
            return;
        }
    }

    private static bool IsInside(string path, string directory)
    {
        var fullPath = Path.GetFullPath(path);
        var fullDirectory = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return fullPath.StartsWith(fullDirectory, StringComparison.OrdinalIgnoreCase);
    }

    private static void Install(string root, string running)
    {
        Directory.CreateDirectory(root);
        bool setupCreated;
        using (var setupMutex = new Mutex(true, "Local\\Zavod7.NativeServer.Setup", out setupCreated))
        {
            if (!setupCreated) throw new InvalidOperationException("Другая установка ЗАВОД-7 уже выполняется.");
            bool hadTray;
            using (var trayMutex = AcquireTrayMutex(out hadTray))
            {
                StopServerSafely(hadTray);
                var stage = Path.Combine(root, ".zavod-stage-" + Guid.NewGuid().ToString("N"));
                var backup = Path.Combine(root, ".zavod-dist-backup-" + Guid.NewGuid().ToString("N"));
                var liveDist = Path.Combine(root, "dist");
                var stageDist = Path.Combine(stage, "dist");
                var movedOld = false;
                var movedNew = false;
                var committed = false;
                var registry = CaptureRegistry();
                try
                {
                    Directory.CreateDirectory(stage);
                    ExtractPayload(stage);
                    ValidatePayload(stageDist);
                    var stagedSetup = Path.Combine(stageDist, "native", "Zavod7-Server-Setup.exe");
                    Directory.CreateDirectory(Path.GetDirectoryName(stagedSetup));
                    File.Copy(running, stagedSetup, true);

                    if (Directory.Exists(liveDist)) { Directory.Move(liveDist, backup); movedOld = true; }
                    try { Directory.Move(stageDist, liveDist); movedNew = true; }
                    catch
                    {
                        if (movedOld && !Directory.Exists(liveDist)) Directory.Move(backup, liveDist);
                        movedOld = false;
                        throw;
                    }

                    try { Register(root); }
                    catch
                    {
                        if (movedNew && Directory.Exists(liveDist)) Directory.Move(liveDist, stageDist);
                        movedNew = false;
                        if (movedOld && Directory.Exists(backup)) Directory.Move(backup, liveDist);
                        movedOld = false;
                        RestoreRegistry(registry);
                        throw;
                    }
                    committed = true;
                    if (movedOld && Directory.Exists(backup)) { try { Directory.Delete(backup, true); } catch { } }
                    if (Directory.Exists(stage)) { try { Directory.Delete(stage, true); } catch { } }
                    trayMutex.ReleaseMutex();
                    try
                    {
                        Process.Start(new ProcessStartInfo(Path.Combine(liveDist, "native", "Zavod7-Server-Tray.exe"), "zavod7://server")
                        {
                            UseShellExecute = true,
                            WorkingDirectory = root
                        });
                    }
                    catch (Exception e)
                    {
                        MessageBox.Show("Установка завершена, но панель не запустилась автоматически: " + e.Message, "ЗАВОД-7", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        return;
                    }
                    MessageBox.Show("ЗАВОД-7 Dedicated Server установлен для текущего пользователя. Панель управления откроется в браузере.", "ЗАВОД-7", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch
                {
                    if (!committed)
                    {
                        if (movedNew && Directory.Exists(liveDist) && !Directory.Exists(stageDist)) Directory.Move(liveDist, stageDist);
                        if (movedOld && Directory.Exists(backup) && !Directory.Exists(liveDist)) Directory.Move(backup, liveDist);
                        RestoreRegistry(registry);
                        if (Directory.Exists(stage)) Directory.Delete(stage, true);
                    }
                    throw;
                }
            }
        }
    }

    private static Mutex AcquireTrayMutex(out bool hadTray)
    {
        hadTray = false;
        bool created;
        var mutex = new Mutex(true, TrayMutexName, out created);
        if (created) return mutex;
        try { if (mutex.WaitOne(0)) return mutex; }
        catch (AbandonedMutexException) { return mutex; }
        hadTray = true;
        if (!SignalTray("upgrade")) { mutex.Dispose(); throw new InvalidOperationException("Не удалось безопасно остановить панель. Мир не обновлён."); }
        try
        {
            if (!mutex.WaitOne(7 * 60 * 1000)) throw new InvalidOperationException("Панель не завершила сохранение; установка отменена без изменения файлов.");
        }
        catch (AbandonedMutexException) { }
        return mutex;
    }

    private static bool SignalTray(string command)
    {
        for (int i = 0; i < 30; i++)
        {
            try
            {
                using (var pipe = new NamedPipeClientStream(".", TrayPipeName, PipeDirection.Out))
                {
                    pipe.Connect(250);
                    var bytes = Encoding.ASCII.GetBytes(command + "\n");
                    pipe.Write(bytes, 0, bytes.Length); pipe.Flush(); return true;
                }
            }
            catch (IOException) { Thread.Sleep(100); }
            catch (TimeoutException) { Thread.Sleep(100); }
        }
        return false;
    }

    private static void StopServerSafely(bool trayWasRunning)
    {
        if (trayWasRunning)
        {
            var trayDeadline = DateTime.UtcNow.AddSeconds(15);
            while (DateTime.UtcNow < trayDeadline)
            {
                var trayPort = ControlPortState();
                if (trayPort == 0) return;
                if (trayPort < 0) throw new InvalidOperationException("Не удалось подтвердить остановку сервера после сохранения панели; файлы не изменены.");
                Thread.Sleep(250);
            }
        }
        var port = ControlPortState();
        if (port == 0) return;
        if (port < 0) throw new InvalidOperationException("Нельзя проверить порт управления. Установка остановлена до изменения файлов.");
        var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zavod7", "native-server");
        string bearer, csrf;
        if (!ReadAuth(Path.Combine(data, "controller.json"), out bearer, out csrf)) throw new InvalidOperationException("Сервер работает, но защищённые учётные данные недоступны. Сначала остановите его через панель.");

        string status;
        try { status = Request("/api/v1/status", "GET", bearer, csrf, null, 15000); }
        catch (Exception e) { throw new InvalidOperationException("Не удалось подтвердить состояние сервера; установка отменена без изменения файлов. " + e.Message); }
        var revision = Regex.Match(status, "\\\"revision\\\"\\s*:\\s*(?<n>[0-9]+)");
        if (!revision.Success) throw new InvalidOperationException("Ответ сервера не содержит ревизию; установка отменена без изменения файлов.");
        var requestId = Guid.NewGuid().ToString();
        var body = "{\"requestId\":\"" + requestId + "\",\"expectedRevision\":" + revision.Groups["n"].Value + "}";
        string response;
        try { response = Request("/api/v1/shutdown", "POST", bearer, csrf, body, 5 * 60 * 1000); }
        catch (Exception e) { throw new InvalidOperationException("Сервер не подтвердил сохранение и остановку. Установка отменена без изменения файлов. " + e.Message); }
        if (!Regex.IsMatch(response, "\\\"accepted\\\"\\s*:\\s*true") || !response.Contains(requestId)) throw new InvalidOperationException("Сервер не подтвердил сохранение; файлы не изменены.");
        var deadline = DateTime.UtcNow.AddMinutes(5);
        while (DateTime.UtcNow < deadline)
        {
            var state = ControlPortState();
            if (state == 0) return;
            if (state < 0) throw new InvalidOperationException("Не удалось подтвердить остановку сервера; файлы не изменены.");
            Thread.Sleep(500);
        }
        throw new InvalidOperationException("Сервер не закрыл порт после сохранения; файлы не изменены.");
    }

    // Returns 1 when the service is listening, 0 when refused, and -1 when state is uncertain.
    private static int ControlPortState()
    {
        using (var client = new TcpClient())
        {
            try
            {
                var pending = client.BeginConnect("127.0.0.1", 17837, null, null);
                if (!pending.AsyncWaitHandle.WaitOne(1500)) { client.Close(); return -1; }
                client.EndConnect(pending); return 1;
            }
            catch (SocketException) { return 0; }
            catch { return -1; }
        }
    }

    private static bool ReadAuth(string file, out string bearer, out string csrf)
    {
        bearer = csrf = "";
        try
        {
            var json = File.ReadAllText(file, Encoding.UTF8);
            var m = Regex.Match(json, "\\\"controlAuth\\\"\\s*:\\s*\\{\\s*\\\"token\\\"\\s*:\\s*\\\"(?<token>[A-Za-z0-9_-]{32,128})\\\"\\s*,\\s*\\\"csrf\\\"\\s*:\\s*\\\"(?<csrf>[A-Za-z0-9_-]{32,128})\\\"");
            if (!m.Success) return false;
            bearer = m.Groups["token"].Value; csrf = m.Groups["csrf"].Value; return true;
        }
        catch { return false; }
    }

    private static string Request(string path, string method, string bearer, string csrf, string body, int timeout)
    {
        var request = (HttpWebRequest)WebRequest.Create(ControlOrigin + path);
        request.Method = method; request.Timeout = timeout; request.ReadWriteTimeout = timeout;
        request.Headers[HttpRequestHeader.Authorization] = "Bearer " + bearer;
        request.Headers["X-CSRF-Token"] = csrf; request.Headers["Origin"] = ControlOrigin;
        if (body != null)
        {
            var bytes = Encoding.UTF8.GetBytes(body); request.ContentType = "application/json"; request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
        }
        using (var response = (HttpWebResponse)request.GetResponse())
        using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) return reader.ReadToEnd();
    }

    private static void ExtractPayload(string stage)
    {
        long total = 0; int count = 0;
        using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("PAYLOAD"))
        {
            if (payload == null) throw new InvalidDataException("Installer payload is missing");
            using (var archive = new ZipArchive(payload, ZipArchiveMode.Read, false))
            {
                foreach (var entry in archive.Entries)
                {
                    if (++count > 100000 || entry.Length < 0 || total > MaxExpandedPayload - entry.Length) throw new InvalidDataException("Installer payload exceeds its expansion limit");
                    total += entry.Length;
                    var path = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                    var parts = path.Split(Path.DirectorySeparatorChar);
                    if (Path.IsPathRooted(path) || parts.Length < 2 || parts[0] != "dist" || Array.Exists(parts, p => p == ".." || p == "." || p == "")) throw new InvalidDataException("Unsafe installer path");
                    var target = Path.GetFullPath(Path.Combine(stage, path));
                    if (!target.StartsWith(Path.GetFullPath(stage) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Installer path escaped staging directory");
                    if (entry.Name.Length == 0) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (var src = entry.Open()) using (var dst = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) src.CopyTo(dst);
                }
            }
        }
    }

    private static void ValidatePayload(string dist)
    {
        var expected = new[] {
            Path.Combine(dist, "index.html"),
            Path.Combine(dist, "native", "server.mjs"),
            Path.Combine(dist, "native", "node.exe"),
            Path.Combine(dist, "native", "runtime-manifest.json"),
            Path.Combine(dist, "native", "Zavod7-Server-Tray.exe")
        };
        foreach (var path in expected) if (!File.Exists(path)) throw new InvalidDataException("Installer payload is missing " + Path.GetFileName(path));
        if (!File.ReadAllText(expected[0], Encoding.UTF8).Contains("zavod-native-installer")) throw new InvalidDataException("Game page has no installer discovery link");
    }

    private sealed class RegistrySnapshot
    {
        public object ProtocolDefault, ProtocolUrl, Command, Run;
    }

    private static RegistrySnapshot CaptureRegistry()
    {
        return new RegistrySnapshot {
            ProtocolDefault = Registry.GetValue("HKEY_CURRENT_USER\\" + ClassesPath, "", null),
            ProtocolUrl = Registry.GetValue("HKEY_CURRENT_USER\\" + ClassesPath, "URL Protocol", null),
            Command = Registry.GetValue("HKEY_CURRENT_USER\\" + CommandPath, "", null),
            Run = Registry.GetValue("HKEY_CURRENT_USER\\" + RunPath, "Zavod7NativeServer", null)
        };
    }

    private static void SetRegistryValue(string path, string name, object value)
    {
        if (value == null)
        {
            using (var key = Registry.CurrentUser.OpenSubKey(path, true)) if (key != null) key.DeleteValue(name, false);
        }
        else
        {
            using (var key = Registry.CurrentUser.CreateSubKey(path))
            {
                if (key == null) throw new IOException("Could not open the current-user protocol settings");
                key.SetValue(name, value);
            }
        }
    }

    private static void RestoreRegistry(RegistrySnapshot state)
    {
        try
        {
            SetRegistryValue(ClassesPath, "", state.ProtocolDefault);
            SetRegistryValue(ClassesPath, "URL Protocol", state.ProtocolUrl);
            SetRegistryValue(CommandPath, "", state.Command);
            SetRegistryValue(RunPath, "Zavod7NativeServer", state.Run);
        }
        catch { }
    }

    private static void Register(string root)
    {
        var tray = Path.Combine(root, "dist", "native", "Zavod7-Server-Tray.exe");
        using (var classes = Registry.CurrentUser.CreateSubKey(ClassesPath))
        {
            if (classes == null) throw new IOException("Could not register the current-user protocol");
            classes.SetValue("", "URL:ЗАВОД-7 server controller"); classes.SetValue("URL Protocol", "");
        }
        using (var command = Registry.CurrentUser.CreateSubKey(CommandPath))
        {
            if (command == null) throw new IOException("Could not register the current-user protocol handler");
            command.SetValue("", "\"" + tray + "\" \"%1\"");
        }
        using (var run = Registry.CurrentUser.CreateSubKey(RunPath))
        {
            if (run == null) throw new IOException("Could not register current-user startup");
            run.SetValue("Zavod7NativeServer", "\"" + tray + "\"");
        }
    }
}
