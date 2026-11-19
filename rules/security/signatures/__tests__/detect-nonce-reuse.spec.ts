import { detectNonceReuse } from "../detect-nonce-reuse";

const titles = (code: string) => detectNonceReuse(code).findings.map((f) => f.title);

describe("detectNonceReuse", () => {
  it("flags a nonce that is validated but never consumed", () => {
    const code = `contract C {
  mapping(address => uint256) public nonces;
  function exec(address to, uint256 amount, uint256 nonce, bytes memory sig) external {
    require(nonce == nonces[to], "bad nonce");
    bytes32 hash = keccak256(abi.encode(to, amount, nonce));
    address signer = ECDSA.recover(hash, sig);
  }
}`;
    const result = detectNonceReuse(code);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("Nonce is validated but never consumed");
    expect(result.findings[0].severity).toBe("high");
    expect(result.findings[0].functionName).toBe("exec");
  });

  it("accepts consumption inline, as a separate statement, and through a helper", () => {
    const inline = `contract C {
  mapping(address => uint256) public nonces;
  function exec(address to, uint256 nonce, bytes memory sig) external {
    require(nonce == nonces[to]++, "bad nonce");
    address signer = ECDSA.recover(keccak256(abi.encode(to, nonce)), sig);
  }
}`;
    const separate = inline.replace('require(nonce == nonces[to]++, "bad nonce");', 'require(nonce == nonces[to], "bad nonce");\n    nonces[to]++;');
    const helper = `contract C {
  mapping(address => uint256) public nonces;
  function _useNonce(address owner) internal returns (uint256) { return nonces[owner]++; }
  function exec(address to, uint256 nonce, bytes memory sig) external {
    require(nonce == nonces[to], "bad nonce");
    _useNonce(to);
    address signer = ECDSA.recover(keccak256(abi.encode(to, nonce)), sig);
  }
}`;
    expect(titles(inline)).toEqual([]);
    expect(titles(separate)).toEqual([]);
    expect(titles(helper)).toEqual([]);
  });

  it("flags a nonce consumed after an external call (reentrant replay ordering)", () => {
    const code = `contract C {
  mapping(address => uint256) public nonces;
  function exec(address to, uint256 amount, uint256 nonce, bytes memory sig) external {
    require(nonce == nonces[to], "bad nonce");
    address signer = ECDSA.recover(keccak256(abi.encode(to, amount, nonce)), sig);
    token.transfer(to, amount);
    nonces[to]++;
  }
}`;
    const result = detectNonceReuse(code);
    expect(result.findings.map((f) => f.title)).toEqual(["Nonce is consumed after an external call"]);
    expect(result.findings[0].line).toBe(7);
    const viaCall = code.replace("token.transfer(to, amount);", '(bool ok, ) = to.call{value: amount}("");');
    expect(titles(viaCall)).toEqual(["Nonce is consumed after an external call"]);
    const fixed = code.replace("    token.transfer(to, amount);\n    nonces[to]++;", "    nonces[to]++;\n    token.transfer(to, amount);");
    expect(titles(fixed)).toEqual([]);
  });

  it("flags only the method that skips consumption of a shared nonce store", () => {
    const code = `contract C {
  mapping(address => uint256) public nonces;
  function permit(address owner, address spender, uint256 value, bytes memory sig) external {
    bytes32 hash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++));
    address signer = ECDSA.recover(hash, sig);
  }
  function metaTx(address owner, uint256 nonce, bytes memory data, bytes memory sig) external {
    require(nonce == nonces[owner], "bad nonce");
    address signer = ECDSA.recover(keccak256(abi.encode(owner, nonce, data)), sig);
  }
}`;
    const result = detectNonceReuse(code);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].functionName).toBe("metaTx");
    expect(result.findings[0].message).toContain("another method consuming the same store");
  });

  it("flags identical layouts under independent nonce stores, but accepts distinct purposes", () => {
    const method = (name: string, store: string, typehash: string) => `
  function ${name}(address to, uint256 amount, bytes memory sig) external {
    bytes32 hash = keccak256(abi.encode(${typehash}to, amount, ${store}[to]++));
    address signer = ECDSA.recover(hash, sig);
  }`;
    const ambiguous = `contract C {
  mapping(address => uint256) public permitNonces;
  mapping(address => uint256) public orderNonces;${method("permit", "permitNonces", "")}${method("fill", "orderNonces", "")}
}`;
    const separated = `contract C {
  mapping(address => uint256) public permitNonces;
  mapping(address => uint256) public orderNonces;${method("permit", "permitNonces", "PERMIT_TYPEHASH, ")}${method("fill", "orderNonces", "ORDER_TYPEHASH, ")}
}`;
    const shared = `contract C {
  mapping(address => uint256) public nonces;${method("permit", "nonces", "")}${method("fill", "nonces", "")}
}`;
    const result = detectNonceReuse(ambiguous);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("Same signed layout under independent nonce stores");
    expect(result.findings[0].message).toContain("permitNonces vs orderNonces");
    expect(titles(separated)).toEqual([]);
    expect(titles(shared)).toEqual([]);
  });

  it("flags a state-changing signed method with no nonce, and accepts an executed-hash guard", () => {
    const bare = `contract C {
  function pay(address to, uint256 amount, bytes memory sig) external {
    bytes32 hash = keccak256(abi.encode(to, amount));
    address signer = ECDSA.recover(hash, sig);
    token.transfer(to, amount);
  }
}`;
    const guarded = `contract C {
  mapping(bytes32 => bool) public executed;
  function pay(address to, uint256 amount, bytes memory sig) external {
    bytes32 hash = keccak256(abi.encode(to, amount));
    require(!executed[hash], "done");
    executed[hash] = true;
    address signer = ECDSA.recover(hash, sig);
    token.transfer(to, amount);
  }
}`;
    expect(titles(bare)).toEqual(["Signed method has no nonce or replay guard"]);
    expect(titles(guarded)).toEqual([]);
  });

  it("flags a nonce consumed only inside a conditional block", () => {
    const code = `contract C {
  mapping(address => uint256) public nonces;
  function exec(address to, uint256 amount, uint256 nonce, bytes memory sig) external {
    require(nonce == nonces[to], "bad nonce");
    address signer = ECDSA.recover(keccak256(abi.encode(to, amount, nonce)), sig);
    if (amount > 0) {
      nonces[to]++;
    }
  }
}`;
    expect(titles(code)).toEqual(["Nonce is consumed only on some paths"]);
  });

  it("ignores view helpers that only verify a signature", () => {
    const code = `contract C {
  function isValid(bytes32 h, bytes memory sig) public view returns (bool) { return ECDSA.recover(h, sig) == owner; }
}`;
    expect(detectNonceReuse(code).detected).toBe(false);
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["contract A { function f() external {", "", "nonces[a]++;"]) {
      const result = detectNonceReuse(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
