import {
  SorobanContractInterface,
  SorobanFunctionInterface,
  SorobanStructInterface,
  SorobanEventInterface,
} from "./types";

export class SorobanInterfaceRegistry {
  private contracts: Map<string, SorobanContractInterface> = new Map();
  private contractIdMap: Map<string, string> = new Map();

  register(contractInterface: SorobanContractInterface): void {
    this.contracts.set(contractInterface.id, contractInterface);

    if (contractInterface.contractId) {
      this.contractIdMap.set(
        contractInterface.contractId,
        contractInterface.id,
      );
    }
  }

  unregister(id: string): boolean {
    const contract = this.contracts.get(id);
    if (contract?.contractId) {
      this.contractIdMap.delete(contract.contractId);
    }
    return this.contracts.delete(id);
  }

  getById(id: string): SorobanContractInterface | undefined {
    return this.contracts.get(id);
  }

  getByContractId(contractId: string): SorobanContractInterface | undefined {
    const id = this.contractIdMap.get(contractId);
    return id ? this.contracts.get(id) : undefined;
  }

  getAll(): SorobanContractInterface[] {
    return Array.from(this.contracts.values());
  }

  findByName(name: string): SorobanContractInterface[] {
    return this.getAll().filter(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
  }

  findByVersion(version: string): SorobanContractInterface[] {
    return this.getAll().filter((c) => c.version === version);
  }

  searchByName(query: string): SorobanContractInterface[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(
      (c) =>
        c.name.toLowerCase().includes(lowerQuery) ||
        c.metadata.description?.toLowerCase().includes(lowerQuery),
    );
  }

  getFunction(
    contractId: string,
    functionName: string,
  ): SorobanFunctionInterface | undefined {
    const contract = this.getByContractId(contractId);
    if (!contract) return undefined;

    return contract.functions.find((f) => f.name === functionName);
  }

  getInterfaceCount(): number {
    return this.contracts.size;
  }

  clear(): void {
    this.contracts.clear();
    this.contractIdMap.clear();
  }
}
