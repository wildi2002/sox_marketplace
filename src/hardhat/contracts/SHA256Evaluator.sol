// SPDX-License-Identifier: GPL 3.0
pragma solidity ^0.8.0;

library SHA256Evaluator {
    // Rotates a 32-bit word to the right by a specified number of bits.
    function ror(uint32 w, uint8 n) internal pure returns (uint32) {
        return ((w >> n) | (w << (32 - n)));
    }

    // Performs the compression function for SHA-256
    function internalCompression(
        uint32[8] memory _previousDigest,
        bytes memory _inputBlock
    ) internal pure returns (bytes memory) {
        unchecked {
            uint32[64] memory K = [
                0x428a2f98,
                0x71374491,
                0xb5c0fbcf,
                0xe9b5dba5,
                0x3956c25b,
                0x59f111f1,
                0x923f82a4,
                0xab1c5ed5,
                0xd807aa98,
                0x12835b01,
                0x243185be,
                0x550c7dc3,
                0x72be5d74,
                0x80deb1fe,
                0x9bdc06a7,
                0xc19bf174,
                0xe49b69c1,
                0xefbe4786,
                0x0fc19dc6,
                0x240ca1cc,
                0x2de92c6f,
                0x4a7484aa,
                0x5cb0a9dc,
                0x76f988da,
                0x983e5152,
                0xa831c66d,
                0xb00327c8,
                0xbf597fc7,
                0xc6e00bf3,
                0xd5a79147,
                0x06ca6351,
                0x14292967,
                0x27b70a85,
                0x2e1b2138,
                0x4d2c6dfc,
                0x53380d13,
                0x650a7354,
                0x766a0abb,
                0x81c2c92e,
                0x92722c85,
                0xa2bfe8a1,
                0xa81a664b,
                0xc24b8b70,
                0xc76c51a3,
                0xd192e819,
                0xd6990624,
                0xf40e3585,
                0x106aa070,
                0x19a4c116,
                0x1e376c08,
                0x2748774c,
                0x34b0bcb5,
                0x391c0cb3,
                0x4ed8aa4a,
                0x5b9cca4f,
                0x682e6ff3,
                0x748f82ee,
                0x78a5636f,
                0x84c87814,
                0x8cc70208,
                0x90befffa,
                0xa4506ceb,
                0xbef9a3f7,
                0xc67178f2
            ];

            uint32[64] memory words = prepareMessageSchedule(_inputBlock);

            // cloning _previousDigest
            uint32[8] memory state;
            state[0] = _previousDigest[0];
            state[1] = _previousDigest[1];
            state[2] = _previousDigest[2];
            state[3] = _previousDigest[3];
            state[4] = _previousDigest[4];
            state[5] = _previousDigest[5];
            state[6] = _previousDigest[6];
            state[7] = _previousDigest[7];

            for (uint i = 0; i < 64; ++i) {
                (
                    state[0],
                    state[1],
                    state[2],
                    state[3],
                    state[4],
                    state[5],
                    state[6],
                    state[7]
                ) = compressionRound(
                    state[0],
                    state[1],
                    state[2],
                    state[3],
                    state[4],
                    state[5],
                    state[6],
                    state[7],
                    words[i],
                    K[i]
                );
            }

            bytes memory result = new bytes(32);
            for (uint i = 0; i < 8; ++i) {
                uint32 sum = state[i] + _previousDigest[i];
                assembly {
                    mstore(add(add(result, 0x20), mul(i, 4)), shl(224, sum)) // store big-endian bytes4
                }
            }

            return result;
        }
    }

    // Prepares the message schedule for SHA-256.
    function prepareMessageSchedule(
        bytes memory _inputBlock
    ) internal pure returns (uint32[64] memory words) {
        unchecked {
            for (uint i = 0; i < 16; ++i) {
                words[i] =
                    (uint32(uint8(_inputBlock[i * 4])) << 24) |
                    (uint32(uint8(_inputBlock[i * 4 + 1])) << 16) |
                    (uint32(uint8(_inputBlock[i * 4 + 2])) << 8) |
                    uint32(uint8(_inputBlock[i * 4 + 3]));
            }

            for (uint i = 16; i < 64; ++i) {
                uint32 s0 = ror(words[i - 15], 7) ^
                    ror(words[i - 15], 18) ^
                    (words[i - 15] >> 3);
                uint32 s1 = ror(words[i - 2], 17) ^
                    ror(words[i - 2], 19) ^
                    (words[i - 2] >> 10);
                words[i] = words[i - 16] + s0 + words[i - 7] + s1;
            }

            return words;
        }
    }

    // Performs a single round of the SHA-256 compression function
    function compressionRound(
        uint32 a,
        uint32 b,
        uint32 c,
        uint32 d,
        uint32 e,
        uint32 f,
        uint32 g,
        uint32 h,
        uint32 w,
        uint32 k
    )
        internal
        pure
        returns (uint32, uint32, uint32, uint32, uint32, uint32, uint32, uint32)
    {
        unchecked {
            uint32 s1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
            uint32 ch = (e & f) ^ (~e & g);
            uint32 tmp1 = h + s1 + ch + k + w;
            uint32 s0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
            uint32 maj = (a & b) ^ (a & c) ^ (b & c);
            uint32 tmp2 = s0 + maj;

            return (tmp1 + tmp2, a, b, c, d + tmp1, e, f, g);
        }
    }

    /**
     * @notice Performs the SHA-256 compression instruction.
     * @dev This function performs the SHA-256 compression on the provided data.
     * @param _data The data to compress. The format should be the following: 
                [previous digest (optional; 32 bytes), block (64 bytes)]
     * @return The compressed data.
     */
    function sha256CompressionInstruction(
        bytes[] memory _data
    ) external pure returns (bytes memory) {
        require(_data.length > 0, "Data is empty");
        uint32[8] memory previousDigest;
        bytes memory inputBlock;

        if (_data.length > 1) {
            require(
                _data[0].length == 32,
                "Previous digest must be 32 bytes long"
            );

            require(
                _data[1].length == 64,
                "Block to hash must be 64 bytes long"
            );
            // a previous digest has been passed
            previousDigest = preparePreviousDigest(_data[0], false);
            inputBlock = _data[1];
        } else {
            require(
                _data[0].length == 64,
                "Block to hash must be 64 bytes long"
            );

            previousDigest = preparePreviousDigest(_data[0], true);
            inputBlock = _data[0];
        }

        return internalCompression(previousDigest, inputBlock);
    }

    /**
     * @notice Performs the final SHA-256 compression instruction (padding + compression).
     * @dev This function performs the final SHA-256 compression on the provided data.
     * @param _data The data to compress. The format should be the following: 
            [
                previous digest (optional; 32 bytes), 
                block (64 bytes), 
                message length (8 bytes, big-endian)
            ]
     * @return The compressed data.
     */
    function sha256FinalCompressionInstruction(
        bytes[] memory _data
    ) external pure returns (bytes memory) {
        require(_data.length > 0, "Data is empty");
        uint32[8] memory previousDigest;
        bytes memory inputBlock;
        uint64 full_data_length;

        if (_data.length == 2) {
            require(
                _data[0].length <= 64,
                "Block to hash must be at most 64 bytes long"
            );

            require(
                _data[1].length == 8,
                "Hashed message length must be 8 bytes long"
            );

            previousDigest = preparePreviousDigest(_data[0], true);
            inputBlock = _data[0];
            full_data_length = uint64(bytes8(_data[1]));
        } else if (_data.length == 3) {
            require(
                _data[0].length == 32,
                "Previous digest must be 32 bytes long"
            );

            require(
                _data[1].length <= 64,
                "Block to hash must be at most 64 bytes long"
            );

            require(
                _data[2].length == 8,
                "Hashed message length must be 8 bytes long"
            );

            previousDigest = preparePreviousDigest(_data[0], false);
            inputBlock = _data[1];
            full_data_length = uint64(bytes8(_data[2]));
        } else {
            revert("Incorrect number of inputs");
        }

        (bytes memory paddedFirst, bytes memory paddedSecond) = sha256Padding(
            inputBlock,
            full_data_length
        );
        bytes memory result = internalCompression(previousDigest, paddedFirst);

        if (paddedSecond.length == 64) {
            previousDigest = bytes_to_uint32_array(result);
            result = internalCompression(previousDigest, paddedSecond);
        }

        return result;
    }

    // Prepares the previous digest for SHA-256 compression instruction
    function preparePreviousDigest(
        bytes memory _data,
        bool isDefault
    ) internal pure returns (uint32[8] memory previousDigest) {
        if (isDefault) {
            return [
                // initial hash values
                0x6a09e667,
                0xbb67ae85,
                0x3c6ef372,
                0xa54ff53a,
                0x510e527f,
                0x9b05688c,
                0x1f83d9ab,
                0x5be0cd19
            ];
        } else {
            return bytes_to_uint32_array(_data);
        }
    }

    // Performs a standard SHA-256 padding on the last block of data
    function sha256Padding(
        bytes memory _lastBlock,
        uint64 _fullDataLen
    ) internal pure returns (bytes memory, bytes memory) {
        uint paddedMinLen = _lastBlock.length + 9;
        bytes memory firstBlock = new bytes(64);
        uint64 i = 0;
        for (; i < _lastBlock.length; ++i) {
            firstBlock[i] = _lastBlock[i];
        }

        bytes8 dataLenBits = bytes8(_fullDataLen * 8);
        if (paddedMinLen <= 64) {
            firstBlock[_lastBlock.length] = 0x80;
            firstBlock[56] = dataLenBits[0];
            firstBlock[57] = dataLenBits[1];
            firstBlock[58] = dataLenBits[2];
            firstBlock[59] = dataLenBits[3];
            firstBlock[60] = dataLenBits[4];
            firstBlock[61] = dataLenBits[5];
            firstBlock[62] = dataLenBits[6];
            firstBlock[63] = dataLenBits[7];

            return (firstBlock, new bytes(0));
        } else {
            bytes memory secondBlock = new bytes(64);

            if (i == 64) {
                secondBlock[0] = 0x80;
            } else {
                firstBlock[i] = 0x80;
            }

            secondBlock[56] = dataLenBits[0];
            secondBlock[57] = dataLenBits[1];
            secondBlock[58] = dataLenBits[2];
            secondBlock[59] = dataLenBits[3];
            secondBlock[60] = dataLenBits[4];
            secondBlock[61] = dataLenBits[5];
            secondBlock[62] = dataLenBits[6];
            secondBlock[63] = dataLenBits[7];

            return (firstBlock, secondBlock);
        }
    }

    // Converts a byte array to a uint32 array.
    function bytes_to_uint32_array(
        bytes memory _input
    ) internal pure returns (uint32[8] memory result) {
        result[0] = uint32(
            bytes4(bytes.concat(_input[0], _input[1], _input[2], _input[3]))
        );
        result[1] = uint32(
            bytes4(bytes.concat(_input[4], _input[5], _input[6], _input[7]))
        );
        result[2] = uint32(
            bytes4(bytes.concat(_input[8], _input[9], _input[10], _input[11]))
        );
        result[3] = uint32(
            bytes4(bytes.concat(_input[12], _input[13], _input[14], _input[15]))
        );
        result[4] = uint32(
            bytes4(bytes.concat(_input[16], _input[17], _input[18], _input[19]))
        );
        result[5] = uint32(
            bytes4(bytes.concat(_input[20], _input[21], _input[22], _input[23]))
        );
        result[6] = uint32(
            bytes4(bytes.concat(_input[24], _input[25], _input[26], _input[27]))
        );
        result[7] = uint32(
            bytes4(bytes.concat(_input[28], _input[29], _input[30], _input[31]))
        );
    }
}
