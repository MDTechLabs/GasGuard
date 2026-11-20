pragma solidity ^0.8.20;
contract NestedArrayHash {
    struct Item { uint256 id; }
    bytes32 constant BATCH_TYPEHASH = keccak256("Batch(address maker,Item[] items,uint256 nonce)Item(uint256 id)");
    bytes32 constant ITEM_TYPEHASH = keccak256("Item(uint256 id)");
    function hashBatch(address maker, Item[] memory items, uint256 nonce) external pure returns (bytes32) {
        return keccak256(abi.encode(BATCH_TYPEHASH, maker, _hashItems(items), nonce));
    }
    function _hashItems(Item[] memory items) private pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](items.length);
        for (uint256 i = 0; i < items.length; ++i) {
            hashes[i] = keccak256(abi.encode(ITEM_TYPEHASH, items[i].id));
        }
        return keccak256(abi.encodePacked(hashes));
    }
}
