pragma solidity ^0.8.20;
contract PackedDynamicHash {
    bytes32 constant ORDER_TYPEHASH = keccak256("Order(string note,bytes data)");
    struct Order { string note; bytes data; }
    function hashOrder(Order memory order) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(ORDER_TYPEHASH, order.note, order.data));
    }
}
