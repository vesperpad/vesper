// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title FeeSplitter
/// @notice Receives ETH (secondary-sale royalties and the redeem fee) and splits it between the
///         creator and dev at a fixed ratio (default 60/40). Pull-based: accepts ETH in `receive()`
///         and pays out on `release()`, so senders (marketplaces) never run heavy logic.
contract FeeSplitter {
    address public immutable creator;
    address public immutable dev;
    uint256 public immutable creatorBps; // e.g. 6000 = 60%

    event Released(uint256 toCreator, uint256 toDev);

    constructor(address _creator, address _dev, uint256 _creatorBps) {
        require(_creator != address(0) && _dev != address(0), "ZERO");
        require(_creatorBps <= 10_000, "BPS");
        creator = _creator;
        dev = _dev;
        creatorBps = _creatorBps;
    }

    receive() external payable {}

    /// @notice Split the current balance and pay creator + dev. Callable by anyone.
    function release() public {
        uint256 bal = address(this).balance;
        if (bal == 0) return;
        uint256 c = (bal * creatorBps) / 10_000;
        uint256 d = bal - c;
        if (c > 0) { (bool ok1,) = creator.call{value: c}(""); require(ok1, "CREATOR"); }
        if (d > 0) { (bool ok2,) = dev.call{value: d}(""); require(ok2, "DEV"); }
        emit Released(c, d);
    }
}
