pragma solidity ^0.8.20;
interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}
contract SafeSignatures {
    bytes32 private _cachedDomainSeparator;
    uint256 private _cachedChainId;
    bytes32 constant ORDER_TYPEHASH = keccak256("Order(address maker,string memo,uint256 nonce)");
    address public owner;
    constructor() {
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = keccak256(abi.encode(block.chainid, address(this)));
    }
    function domainSeparator() external view returns (bytes32) {
        return block.chainid == _cachedChainId ? _cachedDomainSeparator : _buildDomainSeparator();
    }
    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this)));
    }
    function hashOrder(address maker, string memory memo, uint256 nonce) external pure returns (bytes32) {
        return keccak256(abi.encode(ORDER_TYPEHASH, maker, keccak256(bytes(memo)), nonce));
    }
    function verifyTyped(bytes32 structHash, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ecrecover(digest, v, r, s);
        require(signer == owner, "bad signature");
        owner = signer;
    }
    function verifyContract(address signer, bytes32 digest, bytes calldata signature) external view returns (bool) {
        return IERC1271(signer).isValidSignature(digest, signature) == 0x1626ba7e;
    }
}
