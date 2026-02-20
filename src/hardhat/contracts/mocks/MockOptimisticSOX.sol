// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IDisputeDeployer {
    function deployDispute(
        address _entryPoint,
        address _optimisticContract,
        uint32 _numBlocks,
        uint32 _numGates,
        bytes32 _commitment,
        address _buyerSigner,
        address _vendorSigner,
        address _buyerDisputeSponsorSigner,
        address _vendorDisputeSponsor,
        address _vendorDisputeSponsorSigner
    ) external returns (address);
}

event DisputeDeployed(address deployed);

contract MockOptimisticSOX {
    address public buyer;
    address public vendor;
    address public buyerDisputeSponsor;
    address public vendorDisputeSponsor;
    uint256 public timeoutIncrement;
    uint256 public agreedPrice;
    uint8 public currState = 3; // default WaitSV
    IDisputeDeployer public disputeDeployer;

    constructor(
        address _buyer,
        address _vendor,
        address _buyerDisputeSponsor,
        address _vendorDisputeSponsor,
        uint256 _timeoutIncrement,
        uint256 _agreedPrice,
        address _disputeDeployer
    ) {
        buyer = _buyer;
        vendor = _vendor;
        buyerDisputeSponsor = _buyerDisputeSponsor;
        vendorDisputeSponsor = _vendorDisputeSponsor;
        timeoutIncrement = _timeoutIncrement;
        agreedPrice = _agreedPrice;
        disputeDeployer = IDisputeDeployer(_disputeDeployer);
    }

    function deployDispute(
        uint32 _numBlocks,
        uint32 _numGates,
        bytes32 _commitment
    ) external payable returns (address) {
        payable(address(disputeDeployer)).transfer(address(this).balance);
        address deployed = disputeDeployer.deployDispute(
            address(1),
            address(this),
            _numBlocks,
            _numGates,
            _commitment,
            address(0),
            address(0),
            address(0),
            vendorDisputeSponsor,
            address(0)
        );
        emit DisputeDeployed(deployed);
        return deployed;
    }

    function endDispute() external {}
    function setState(uint8 s) external {
        currState = s;
    }
}
