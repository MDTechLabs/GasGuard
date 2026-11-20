pragma solidity ^0.8.20;
contract PersonalSignAuthorization {
    address public owner;
    function authorize(bytes32 hash, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        address signer = ecrecover(digest, v, r, s);
        require(signer == owner, "bad signature");
        owner = signer;
    }
}
