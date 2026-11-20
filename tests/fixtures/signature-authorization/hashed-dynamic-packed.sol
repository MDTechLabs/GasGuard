pragma solidity ^0.8.20;
contract HashedDynamicPacked {
    bytes32 constant ORDER_TYPEHASH = keccak256("Order(string note,uint256 nonce)");
    function hashOrder(string memory note, uint256 nonce) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(ORDER_TYPEHASH, keccak256(bytes(note)), nonce));
    }
}
