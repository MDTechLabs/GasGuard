pragma solidity ^0.8.20;
contract EcdsaOnlyAuthorization {
    address public owner;
    mapping(address => uint256) public balances;
    function execute(bytes32 digest, uint8 v, bytes32 r, bytes32 s) external {
        address signer = ecrecover(digest, v, r, s);
        require(signer == owner, "bad signature");
        balances[owner] = 0;
    }
}
