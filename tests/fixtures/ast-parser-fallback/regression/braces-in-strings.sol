pragma solidity ^0.8.20;

// contract Fake { function nope() {
contract Messages {
    string public open = "{ not a block";
    string public close = "} also not";
    /* function ghost() { */

    function say() external pure returns (string memory) {
        return "}}}";
    }
}
