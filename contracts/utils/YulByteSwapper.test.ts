import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('YulByteSwapper', function () {
  async function deployHarness() {
    const factory = await ethers.getContractFactory('YulByteSwapperHarness');
    return factory.deploy();
  }

  function reverseBytes(value: bigint): bigint {
    const hex = value.toString(16).padStart(64, '0');

    const reversed = hex.match(/.{2}/g)!.reverse().join('');

    return BigInt(`0x${reversed}`);
  }

  it('reverses a known bytes32 value', async function () {
    const harness = await deployHarness();

    const input =
      '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';

    const expected =
      '0x201f1e1d1c1b1a191817161514131211100f0e0d0c0b0a090807060504030201';

    expect(await harness.swap(input)).to.equal(expected);
  });

  it('returns the same value when all bytes are identical', async function () {
    const harness = await deployHarness();

    const input =
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    expect(await harness.swap(input)).to.equal(input);
  });

  it('correctly reverses zero', async function () {
    const harness = await deployHarness();

    const input =
      '0x0000000000000000000000000000000000000000000000000000000000000000';

    expect(await harness.swap(input)).to.equal(input);
  });

  it('correctly reverses the maximum uint256', async function () {
    const harness = await deployHarness();

    const input =
      '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    expect(await harness.swap(input)).to.equal(input);
  });

  it('matches a high-level endian conversion', async function () {
    const harness = await deployHarness();

    const values = [
      0n,
      1n,
      0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20n,
      0xdeadbeefn,
      0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn,
      (1n << 255n) + 1n,
      (1n << 256n) - 1n,
    ];

    for (const value of values) {
      const expected = reverseBytes(value);
      const actual = await harness.swapUint256(value);

      expect(BigInt(actual)).to.equal(expected);
    }
  });

  it('is its own inverse', async function () {
    const harness = await deployHarness();

    const values = [
      1n,
      0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20n,
      0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn,
      (1n << 255n) + 123456789n,
    ];

    for (const value of values) {
      const first = await harness.swapUint256(value);
      const second = await harness.swapUint256(first);

      expect(BigInt(second)).to.equal(value);
    }
  });
});