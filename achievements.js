// achievements.js

// This array acts as the central brain for all extension gamification.
// 'check' determines if the achievement is unlocked.
// 'progress' returns [current, max] to draw the UI progress bar.

const ACHIEVEMENTS = [
  // ==========================================
  // 🌱 EASY ACHIEVEMENTS (1-15)
  // ==========================================
  {
    id: "first_steps",
    icon: "🎬",
    name: "First Steps",
    description: "Watch your very first episode using the extension.",
    check: (stats) => stats.totalEpisodesTracked >= 1,
    progress: (stats) => [stats.totalEpisodesTracked, 1]
  },
  {
    id: "time_saver",
    icon: "⏭️",
    name: "Time Saver",
    description: "Skip an anime intro for the first time.",
    check: (stats) => stats.timeSavedSeconds >= 90,
    progress: (stats) => [stats.timeSavedSeconds, 90]
  },
  {
    id: "the_critic",
    icon: "✍️",
    name: "The Critic",
    description: "Rate a completed anime using the popup modal.",
    check: (stats) => stats.ratingsSubmitted >= 1,
    progress: (stats) => [stats.ratingsSubmitted, 1]
  },
  {
    id: "warming_up",
    icon: "🔥",
    name: "Warming Up",
    description: "Hit a 3-day watching streak.",
    check: (stats) => stats.streak >= 3,
    progress: (stats) => [stats.streak, 3]
  },
  {
    id: "night_owl",
    icon: "🦉",
    name: "Night Owl",
    description: "Watch an episode between 2:00 AM and 5:00 AM.",
    check: (stats) => stats.hourOfDay >= 2 && stats.hourOfDay < 5
    // No progress bar (Event based)
  },
  {
    id: "early_bird",
    icon: "🌅",
    name: "Early Bird",
    description: "Watch an episode between 5:00 AM and 8:00 AM.",
    check: (stats) => stats.hourOfDay >= 5 && stats.hourOfDay < 8
    // No progress bar (Event based)
  },
  {
    id: "binge_beginner",
    icon: "🍿",
    name: "Binge Beginner",
    description: "Watch 3 episodes in a single calendar day.",
    check: (stats) => stats.episodesToday >= 3,
    progress: (stats) => [stats.episodesToday, 3]
  },
  {
    id: "level_5",
    icon: "🥉",
    name: "Level 5 Reached",
    description: "Reach RPG Level 5.",
    check: (stats) => stats.level >= 5,
    progress: (stats) => [stats.level, 5]
  },
  {
    id: "double_digits",
    icon: "📺",
    name: "Double Digits",
    description: "Watch 10 total episodes using the extension.",
    check: (stats) => stats.totalEpisodesTracked >= 10,
    progress: (stats) => [stats.totalEpisodesTracked, 10]
  },
  {
    id: "first_completion",
    icon: "🏁",
    name: "First Completion",
    description: "Finish an entire anime series.",
    check: (stats) => stats.completedSeries >= 1,
    progress: (stats) => [stats.completedSeries, 1]
  },
  {
    id: "hour_saved",
    icon: "⏳",
    name: "Hour Saved",
    description: "Skip 60 minutes worth of intros.",
    check: (stats) => stats.timeSavedSeconds >= 3600,
    progress: (stats) => [stats.timeSavedSeconds / 60, 60] // Formatted in minutes
  },
  {
    id: "weekend_warrior",
    icon: "📅",
    name: "Weekend Warrior",
    description: "Watch an episode on a Saturday or Sunday.",
    check: (stats) => stats.dayOfWeek === 0 || stats.dayOfWeek === 6
    // No progress bar (Event based)
  },
  {
    id: "reviewer",
    icon: "🌟",
    name: "Reviewer",
    description: "Submit ratings for 5 different anime.",
    check: (stats) => stats.ratingsSubmitted >= 5,
    progress: (stats) => [stats.ratingsSubmitted, 5]
  },
  {
    id: "dedicated_viewer",
    icon: "⏱️",
    name: "Dedicated Viewer",
    description: "Accumulate 24 hours of true watch time.",
    check: (stats) => stats.trueWatchSeconds >= 86400,
    progress: (stats) => [stats.trueWatchSeconds / 3600, 24] // Formatted in hours
  },
  {
    id: "level_10",
    icon: "🥈",
    name: "Level 10 Reached",
    description: "Reach RPG Level 10.",
    check: (stats) => stats.level >= 10,
    progress: (stats) => [stats.level, 10]
  },

  // ==========================================
  // ⚔️ MODERATE ACHIEVEMENTS (16-30)
  // ==========================================
  {
    id: "on_fire",
    icon: "🔥",
    name: "On Fire",
    description: "Hit a 10-day watching streak.",
    check: (stats) => stats.streak >= 10,
    progress: (stats) => [stats.streak, 10]
  },
  {
    id: "binge_watcher",
    icon: "🍿",
    name: "Binge Watcher",
    description: "Watch 7 episodes in a single calendar day.",
    check: (stats) => stats.episodesToday >= 7,
    progress: (stats) => [stats.episodesToday, 7]
  },
  {
    id: "half_century",
    icon: "📼",
    name: "Half Century",
    description: "Watch 50 total episodes.",
    check: (stats) => stats.totalEpisodesTracked >= 50,
    progress: (stats) => [stats.totalEpisodesTracked, 50]
  },
  {
    id: "level_25",
    icon: "🥇",
    name: "Level 25 Reached",
    description: "Reach RPG Level 25.",
    check: (stats) => stats.level >= 25,
    progress: (stats) => [stats.level, 25]
  },
  {
    id: "seasoned_vet",
    icon: "🏁",
    name: "Seasoned Vet",
    description: "Finish 10 entire anime series.",
    check: (stats) => stats.completedSeries >= 10,
    progress: (stats) => [stats.completedSeries, 10]
  },
  {
    id: "half_day_saver",
    icon: "⏳",
    name: "Half-Day Saver",
    description: "Skip 12 hours worth of intros.",
    check: (stats) => stats.timeSavedSeconds >= 43200,
    progress: (stats) => [stats.timeSavedSeconds / 3600, 12] // Formatted in hours
  },
  {
    id: "century_mark",
    icon: "💯",
    name: "Century Mark",
    description: "Watch 100 total episodes.",
    check: (stats) => stats.totalEpisodesTracked >= 100,
    progress: (stats) => [stats.totalEpisodesTracked, 100]
  },
  {
    id: "top_critic",
    icon: "🌟",
    name: "Top Critic",
    description: "Submit ratings for 20 different anime.",
    check: (stats) => stats.ratingsSubmitted >= 20,
    progress: (stats) => [stats.ratingsSubmitted, 20]
  },
  {
    id: "hundred_hours",
    icon: "⏱️",
    name: "100 Hours",
    description: "Accumulate 100 hours of true watch time.",
    check: (stats) => stats.trueWatchSeconds >= 360000,
    progress: (stats) => [stats.trueWatchSeconds / 3600, 100] // Formatted in hours
  },
  {
    id: "unstoppable",
    icon: "🔥",
    name: "Unstoppable",
    description: "Hit a 30-day watching streak (A full month!).",
    check: (stats) => stats.streak >= 30,
    progress: (stats) => [stats.streak, 30]
  },
  {
    id: "level_50",
    icon: "🏆",
    name: "Level 50 Reached",
    description: "Reach RPG Level 50 (Halfway to Max!).",
    check: (stats) => stats.level >= 50,
    progress: (stats) => [stats.level, 50]
  },
  {
    id: "library_builder",
    icon: "🏁",
    name: "Library Builder",
    description: "Finish 25 entire anime series.",
    check: (stats) => stats.completedSeries >= 25,
    progress: (stats) => [stats.completedSeries, 25]
  },
  {
    id: "anime_marathon",
    icon: "🍿",
    name: "Anime Marathon",
    description: "Watch 12 episodes in a single calendar day.",
    check: (stats) => stats.episodesToday >= 12,
    progress: (stats) => [stats.episodesToday, 12]
  },
  {
    id: "two_fifty",
    icon: "📼",
    name: "Two-Fifty",
    description: "Watch 250 total episodes.",
    check: (stats) => stats.totalEpisodesTracked >= 250,
    progress: (stats) => [stats.totalEpisodesTracked, 250]
  },
  {
    id: "quarter_k",
    icon: "⏱️",
    name: "Quarter-K",
    description: "Accumulate 250 hours of true watch time.",
    check: (stats) => stats.trueWatchSeconds >= 900000,
    progress: (stats) => [stats.trueWatchSeconds / 3600, 250] // Formatted in hours
  },

  // ==========================================
  // 👑 HARDCORE ACHIEVEMENTS (31-40)
  // ==========================================
  {
    id: "time_wizard_max",
    icon: "⏳",
    name: "Time Wizard",
    description: "Skip 24 entire hours worth of intros.",
    check: (stats) => stats.timeSavedSeconds >= 86400,
    progress: (stats) => [stats.timeSavedSeconds / 3600, 24] // Formatted in hours
  },
  {
    id: "five_hundred_club",
    icon: "📼",
    name: "500 Club",
    description: "Watch 500 total episodes.",
    check: (stats) => stats.totalEpisodesTracked >= 500,
    progress: (stats) => [stats.totalEpisodesTracked, 500]
  },
  {
    id: "otaku_status",
    icon: "🏁",
    name: "Otaku Status",
    description: "Finish 50 entire anime series.",
    check: (stats) => stats.completedSeries >= 50,
    progress: (stats) => [stats.completedSeries, 50]
  },
  {
    id: "daily_ritual",
    icon: "🔥",
    name: "Daily Ritual",
    description: "Hit a 100-day watching streak.",
    check: (stats) => stats.streak >= 100,
    progress: (stats) => [stats.streak, 100]
  },
  {
    id: "level_75",
    icon: "💎",
    name: "Level 75 Reached",
    description: "Reach RPG Level 75.",
    check: (stats) => stats.level >= 75,
    progress: (stats) => [stats.level, 75]
  },
  {
    id: "thousand_hours",
    icon: "⏱️",
    name: "1,000 Hours",
    description: "Accumulate 1,000 hours of true watch time.",
    check: (stats) => stats.trueWatchSeconds >= 3600000,
    progress: (stats) => [stats.trueWatchSeconds / 3600, 1000] // Formatted in hours
  },
  {
    id: "completionist",
    icon: "🏁",
    name: "Completionist",
    description: "Finish 100 entire anime series.",
    check: (stats) => stats.completedSeries >= 100,
    progress: (stats) => [stats.completedSeries, 100]
  },
  {
    id: "millennium",
    icon: "📼",
    name: "Millennium",
    description: "Watch 1,000 total episodes.",
    check: (stats) => stats.totalEpisodesTracked >= 1000,
    progress: (stats) => [stats.totalEpisodesTracked, 1000]
  },
  {
    id: "the_grind",
    icon: "⏱️",
    name: "The Grind",
    description: "Accumulate 50,000 minutes (833 hours) watched.",
    check: (stats) => stats.trueWatchSeconds >= 3000000,
    progress: (stats) => [stats.trueWatchSeconds / 60, 50000] // Formatted in minutes
  },
  {
    id: "legend_of_anime",
    icon: "👑",
    name: "Legend of Anime",
    description: "Reach MAX Level (100).",
    check: (stats) => stats.level >= 100,
    progress: (stats) => [stats.level, 100]
  }
];