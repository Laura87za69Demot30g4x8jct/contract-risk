// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConfidentialContractRiskFHE is SepoliaConfig {
    // Audit note
    struct EncContract {
        uint256 id;
        euint32 encryptedMetadata;
        euint32 encryptedText;
        euint32 encryptedModelOutput;
        uint256 uploadedAt;
    }

    // Audit note
    struct AnalysisResult {
        string metadata;
        string modelOutput;
        bool revealed;
    }

    // Audit note
    uint256 public totalContracts;
    mapping(uint256 => EncContract) public contractsEncrypted;
    mapping(uint256 => AnalysisResult) public analyses;

    // Audit note
    mapping(string => euint32) private encryptedRiskBucketCount;
    string[] private riskBuckets;

    // Audit note
    mapping(uint256 => uint256) private decryptionRequests;

    // Audit note
    event ContractUploaded(uint256 indexed id, uint256 timestamp);
    event AnalysisRequested(uint256 indexed id);
    event AnalysisDecrypted(uint256 indexed id);

    // Audit note
    modifier onlyUploader(uint256 contractId) {
        // placeholder for access control
        _;
    }

    /// @notice submit an encrypted contract
    function uploadEncryptedContract(
        euint32 encryptedMetadata,
        euint32 encryptedText,
        euint32 encryptedModelOutput
    ) public {
        totalContracts += 1;
        uint256 cid = totalContracts;

        contractsEncrypted[cid] = EncContract({
            id: cid,
            encryptedMetadata: encryptedMetadata,
            encryptedText: encryptedText,
            encryptedModelOutput: encryptedModelOutput,
            uploadedAt: block.timestamp
        });

        analyses[cid] = AnalysisResult({
            metadata: "",
            modelOutput: "",
            revealed: false
        });

        emit ContractUploaded(cid, block.timestamp);
    }

    /// @notice request analysis decryption
    function requestAnalysisDecryption(uint256 contractId) public onlyUploader(contractId) {
        EncContract storage c = contractsEncrypted[contractId];
        require(!analyses[contractId].revealed, "Already revealed");

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(c.encryptedModelOutput);
        cts[1] = FHE.toBytes32(c.encryptedMetadata);

        uint256 rid = FHE.requestDecryption(cts, this.onAnalysisDecrypted.selector);
        decryptionRequests[rid] = contractId;

        emit AnalysisRequested(contractId);
    }

    /// @notice callback for decrypted analysis
    function onAnalysisDecrypted(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 contractId = decryptionRequests[requestId];
        require(contractId != 0, "Invalid request");
        AnalysisResult storage ar = analyses[contractId];
        require(!ar.revealed, "Already revealed");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory parts = abi.decode(cleartexts, (string[]));

        ar.modelOutput = parts[0];
        ar.metadata = parts[1];
        ar.revealed = true;

        // Update bucket counts if needed
        if (FHE.isInitialized(encryptedRiskBucketCount[ar.metadata]) == false) {
            encryptedRiskBucketCount[ar.metadata] = FHE.asEuint32(0);
            riskBuckets.push(ar.metadata);
        }
        encryptedRiskBucketCount[ar.metadata] = FHE.add(
            encryptedRiskBucketCount[ar.metadata],
            FHE.asEuint32(1)
        );

        emit AnalysisDecrypted(contractId);
    }

    /// @notice view decrypted analysis
    function getAnalysis(uint256 contractId) public view returns (
        string memory metadata,
        string memory modelOutput,
        bool revealed
    ) {
        AnalysisResult storage ar = analyses[contractId];
        return (ar.metadata, ar.modelOutput, ar.revealed);
    }

    /// @notice get encrypted count for a risk bucket
    function getEncryptedBucketCount(string memory bucket) public view returns (euint32) {
        return encryptedRiskBucketCount[bucket];
    }

    /// @notice request decryption of a bucket count
    function requestBucketCountDecryption(string memory bucket) public {
        euint32 cnt = encryptedRiskBucketCount[bucket];
        require(FHE.isInitialized(cnt), "Bucket missing");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(cnt);

        uint256 rid = FHE.requestDecryption(cts, this.onBucketCountDecrypted.selector);
        decryptionRequests[rid] = bytes32ToUint(keccak256(abi.encodePacked(bucket)));
    }

    /// @notice callback for decrypted bucket count
    function onBucketCountDecrypted(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 bucketHash = decryptionRequests[requestId];
        string memory bucket = bucketFromHash(bucketHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 cnt = abi.decode(cleartexts, (uint32));
        // placeholder for handling decrypted count
    }

    // Utility
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function bucketFromHash(uint256 h) private view returns (string memory) {
        for (uint i = 0; i < riskBuckets.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(riskBuckets[i]))) == h) {
                return riskBuckets[i];
            }
        }
        revert("Bucket not found");
    }

    // Internal helper
    function initializeBucketIfMissing(string memory bucket) internal {
        if (!FHE.isInitialized(encryptedRiskBucketCount[bucket])) {
            encryptedRiskBucketCount[bucket] = FHE.asEuint32(0);
            riskBuckets.push(bucket);
        }
    }

    // Internal helper
    function incrementBucket(string memory bucket) internal {
        encryptedRiskBucketCount[bucket] = FHE.add(
            encryptedRiskBucketCount[bucket],
            FHE.asEuint32(1)
        );
    }
}
