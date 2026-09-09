// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @dev Standard Chainlink push-feed interface. Confirmed live against the
///      real deployed HBAR/USD feed on Hedera testnet (296) before writing
///      this — decimals() returns 8, description() returns "HBAR / USD".
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/**
 * @title HbarUsdPriceReader
 * @notice Reads the Chainlink HBAR/USD Data Feed on Hedera and converts a
 *         tinybar amount (the unit CouponDistributor pays in) to USD cents,
 *         with the completeness and staleness checks the Chainlink Data
 *         Feeds skill this project contributed to the Hedera Harness
 *         (hedera-schedule-service's sibling skill in the same plugin)
 *         documents as mandatory — never trust an incomplete or stale round.
 *
 * This is a read-only, additive helper: it does not change how coupons are
 * computed or paid (that stays exactly CouponDistributor's business), it
 * only answers "what is that HBAR payment worth in USD right now" — the
 * bond's own nominal value and coupon rate are already USD-denominated, but
 * nothing in this project could previously state the actual settlement
 * amount in the same currency the bond is denominated in.
 */
contract HbarUsdPriceReader {
    AggregatorV3Interface public immutable feed;
    uint256 public immutable maxStaleness;

    error IncompleteRound(uint80 roundId, uint80 answeredInRound);
    error InvalidPrice(int256 answer);
    error StalePrice(uint256 updatedAt, uint256 maxStalenessSeconds);

    constructor(address _feed, uint256 _maxStaleness) {
        feed = AggregatorV3Interface(_feed);
        maxStaleness = _maxStaleness;
    }

    /// @return priceCents The HBAR/USD price, in USD cents per whole HBAR.
    /// @return updatedAt The feed round's own update timestamp.
    function latestHbarUsdCents() public view returns (uint256 priceCents, uint256 updatedAt) {
        (uint80 roundId, int256 answer, , uint256 roundUpdatedAt, uint80 answeredInRound) =
            feed.latestRoundData();

        if (answeredInRound < roundId || roundUpdatedAt == 0) {
            revert IncompleteRound(roundId, answeredInRound);
        }
        if (answer <= 0) revert InvalidPrice(answer);
        if (block.timestamp - roundUpdatedAt > maxStaleness) {
            revert StalePrice(roundUpdatedAt, maxStaleness);
        }

        uint8 feedDecimals = feed.decimals();
        // Normalize the feed's own decimals to cents (2 decimals) rather
        // than assuming 8, so this keeps working if the feed is ever
        // replaced with one at a different precision.
        priceCents = feedDecimals >= 2
            ? uint256(answer) / (10 ** (feedDecimals - 2))
            : uint256(answer) * (10 ** (2 - feedDecimals));
        updatedAt = roundUpdatedAt;
    }

    /// @notice Converts a tinybar amount (10^8 tinybar = 1 HBAR) to USD cents.
    function tinybarToUsdCents(uint256 tinybarAmount) external view returns (uint256 usdCents) {
        (uint256 priceCents, ) = latestHbarUsdCents();
        // tinybarAmount * priceCents / 10^8 (tinybar per whole HBAR).
        usdCents = (tinybarAmount * priceCents) / 1e8;
    }
}
