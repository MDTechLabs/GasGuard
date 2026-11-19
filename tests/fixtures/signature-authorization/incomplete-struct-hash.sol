pragma solidity ^0.8.20;
contract IncompleteStructHash {
    bytes32 constant PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce)");
    function hashPermit(address owner, address spender, uint256 value, uint256 nonce) external pure returns (bytes32) {
        return keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value));
    }
}
