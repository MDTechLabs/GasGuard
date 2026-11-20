pragma solidity ^0.8.20;
contract ReorderedStructHash {
    bytes32 constant ORDER_TYPEHASH = keccak256("Order(address maker,uint256 amount,uint256 nonce)");
    function hashOrder(address maker, uint256 amount, uint256 nonce) external pure returns (bytes32) {
        return keccak256(abi.encode(ORDER_TYPEHASH, maker, nonce, amount));
    }
}
