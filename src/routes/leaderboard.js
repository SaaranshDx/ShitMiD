const express = require(`express`);
const { getLeaderboard } = require(`../utils/websocketSession`);

const router = express.Router();
const leaderboardPageSize = 10;

router.get(`/api/leaderboard`, async (req, res) => {
  const page = Number(req.query.page || 1);

  if (!Number.isInteger(page) || page < 1) {
    return res.status(400).json({
      error: `Page must be a positive integer`,
    });
  }

  try {
    return res.json(await getLeaderboard(page, leaderboardPageSize));
  } catch (error) {
    console.error(`Failed to load leaderboard:`, error.message);
    return res.status(500).json({
      error: `Failed to load leaderboard`,
    });
  }
});

module.exports = router;
