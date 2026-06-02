import { NetworkConfigService } from "../config/network-config.service";

describe("NetworkConfigService", () => {
  let service: NetworkConfigService;

  beforeEach(() => {
    service = new NetworkConfigService();
  });

  it("returns supported networks from a single source of truth", () => {
    const networks = service.getSupportedNetworks();

    expect(networks.map((network) => network.chainId)).toEqual([
      "soroban-mainnet",
      "soroban-testnet",
    ]);
    expect(networks[0]).toHaveProperty("chainName");
    expect(networks[0]).toHaveProperty("baseFeePerInstruction");
  });

  it("resolves network metadata for a known chain", () => {
    expect(service.getNetworkConfig("soroban-mainnet")).toMatchObject({
      chainId: "soroban-mainnet",
      chainName: "Soroban Mainnet",
    });
  });

  it("rejects unknown chains", () => {
    expect(() => service.getNetworkConfig("unknown-chain")).toThrow(
      "Unsupported chainId: unknown-chain",
    );
  });
});
