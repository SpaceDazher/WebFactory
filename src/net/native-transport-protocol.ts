export const TRANSPORT_ID = /^[a-f0-9]{32}$/;
export function transportResumePayload(worldId: string, generation: number, id: string, nonce: string, serverId: string) {
  return `zavod7-native-transport-resume\n${serverId}\n${worldId}\n${generation}\n${id}\n${nonce}`;
}
export type NativeTransportIdentity = { publicKey?: string; ownerToken?: string };
