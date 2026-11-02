import { networkInterfaces } from 'node:os';

const VIRTUAL_INTERFACE_PATTERN =
  /loopback|vethernet|wsl|docker|vmware|virtualbox/i;

export function resolveAdvertisedHost(configuredHost: string): string {
  if (configuredHost !== 'localhost' && configuredHost !== '127.0.0.1') {
    return configuredHost;
  }

  const candidates = Object.entries(networkInterfaces()).flatMap(
    ([name, addresses]) =>
      (addresses ?? [])
        .filter((address) => address.family === 'IPv4' && !address.internal)
        .map((address) => ({ name, address: address.address })),
  );
  const physical = candidates.find(
    ({ name }) => !VIRTUAL_INTERFACE_PATTERN.test(name),
  );

  return physical?.address ?? candidates[0]?.address ?? configuredHost;
}
