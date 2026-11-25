// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC721 {
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

contract UnsafeVault {
    IERC721 public collection;
    mapping(address => uint256) public credits;

    function withdraw(uint256 tokenId) external {
        collection.safeTransferFrom(address(this), msg.sender, tokenId);
        credits[msg.sender] -= 1;
    }
}

contract SafeVault {
    IERC721 public collection;
    mapping(address => uint256) public credits;

    function withdraw(uint256 tokenId) external {
        credits[msg.sender] -= 1;
        collection.safeTransferFrom(address(this), msg.sender, tokenId);
    }
}

contract StatefulReceiver is IERC721Receiver {
    mapping(uint256 => address) public deposits;

    function onERC721Received(address, address from, uint256 tokenId, bytes calldata)
        external
        returns (bytes4)
    {
        deposits[tokenId] = from;
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract TrustedReceiver is IERC721Receiver {
    IERC721 public collection;
    mapping(uint256 => address) public deposits;

    function onERC721Received(address, address from, uint256 tokenId, bytes calldata)
        external
        returns (bytes4)
    {
        require(msg.sender == address(collection), "untrusted collection");
        deposits[tokenId] = from;
        return IERC721Receiver.onERC721Received.selector;
    }
}

library SafeERC721 {
    function safeTransferFrom(IERC721 token, address from, address to, uint256 tokenId) internal {
        token.safeTransferFrom(from, to, tokenId);
    }
}

abstract contract ReentrancyGuard {
    modifier nonReentrant() {
        _;
    }
}

contract GuardedVault is ReentrancyGuard {
    IERC721 public collection;
    mapping(address => uint256) public credits;

    function withdraw(uint256 tokenId) external nonReentrant {
        collection.safeTransferFrom(address(this), msg.sender, tokenId);
        credits[msg.sender] -= 1;
    }
}

contract LibraryVault {
    IERC721 public collection;
    mapping(address => uint256) public credits;

    function withdraw(uint256 tokenId) external {
        SafeERC721.safeTransferFrom(collection, address(this), msg.sender, tokenId);
        credits[msg.sender] -= 1;
    }
}
