pragma solidity ^0.8.20;
contract CachedDomain {
    bytes32 private _cachedDomainSeparator;
    uint256 private _cachedChainId;
    constructor() {
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = keccak256(abi.encode(block.chainid, address(this)));
    }
    function domainSeparator() external view returns (bytes32) {
        return _cachedDomainSeparator;
    }
}
