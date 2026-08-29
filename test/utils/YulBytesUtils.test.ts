import { expect } from "chai";
import { ethers } from "hardhat";

describe("YulBytesUtils", function () {
  let contract: any;

  beforeEach(async () => {
    const Factory = await ethers.getContractFactory("Example");
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  it("concatenates two byte arrays", async () => {
    const a = "0x112233";
    const b = "0x445566";

    const result = await contract.merge(a, b);

    expect(result).to.equal("0x112233445566");
  });

  it("handles empty first array", async () => {
    const result = await contract.merge("0x", "0x1234");

    expect(result).to.equal("0x1234");
  });

  it("handles empty second array", async () => {
    const result = await contract.merge("0xabcd", "0x");

    expect(result).to.equal("0xabcd");
  });

  it("handles two empty arrays", async () => {
    const result = await contract.merge("0x", "0x");

    expect(result).to.equal("0x");
  });
});
