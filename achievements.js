// achievements.js

// 1. ADDED EXPORT KEYWORD HERE
export const ACHIEVEMENTS = [
  // 🌱 EASY ACHIEVEMENTS (1-15)
  { id: "first_steps", icon: "icons/01.svg", name: "First Steps", description: "Watch your very first episode using the extension.", check: (stats) => stats.totalEpisodesTracked >= 1, progress: (stats) => [stats.totalEpisodesTracked, 1] },
  { id: "time_saver", icon: "icons/02.svg", name: "Time Saver", description: "Skip an anime intro for the first time.", check: (stats) => stats.timeSavedSeconds >= 90, progress: (stats) => [stats.timeSavedSeconds, 90] },
  { id: "the_critic", icon: "icons/03.svg", name: "The Critic", description: "Rate a completed anime using the popup modal.", check: (stats) => stats.ratingsSubmitted >= 1, progress: (stats) => [stats.ratingsSubmitted, 1] },
  { id: "warming_up", icon: "icons/04.svg", name: "Warming Up", description: "Hit a 3-day watching streak.", check: (stats) => stats.streak >= 3, progress: (stats) => [stats.streak, 3] },
  { id: "night_owl", icon: "icons/05.svg", name: "Night Owl", description: "Watch an episode between 2:00 AM and 5:00 AM.", check: (stats) => stats.hourOfDay >= 2 && stats.hourOfDay < 5 },
  { id: "early_bird", icon: "icons/06.svg", name: "Early Bird", description: "Watch an episode between 5:00 AM and 8:00 AM.", check: (stats) => stats.hourOfDay >= 5 && stats.hourOfDay < 8 },
  { id: "binge_beginner", icon: "icons/07.svg", name: "Binge Beginner", description: "Watch 3 episodes in a single calendar day.", check: (stats) => stats.episodesToday >= 3, progress: (stats) => [stats.episodesToday, 3] },
  { id: "level_5", icon: "icons/08.svg", name: "Level 5 Reached", description: "Reach RPG Level 5.", check: (stats) => stats.level >= 5, progress: (stats) => [stats.level, 5] },
  { id: "double_digits", icon: "icons/09.svg", name: "Double Digits", description: "Watch 10 total episodes using the extension.", check: (stats) => stats.totalEpisodesTracked >= 10, progress: (stats) => [stats.totalEpisodesTracked, 10] },
  { id: "first_completion", icon: "icons/10.svg", name: "First Completion", description: "Finish an entire anime series.", check: (stats) => stats.completedSeries >= 1, progress: (stats) => [stats.completedSeries, 1] },
  { id: "hour_saved", icon: "icons/11.svg", name: "Hour Saved", description: "Skip 60 minutes worth of intros.", check: (stats) => stats.timeSavedSeconds >= 3600, progress: (stats) => [stats.timeSavedSeconds / 60, 60] },
  { id: "weekend_warrior", icon: "icons/12.svg", name: "Weekend Warrior", description: "Watch an episode on a Saturday or Sunday.", check: (stats) => stats.dayOfWeek === 0 || stats.dayOfWeek === 6 },
  { id: "reviewer", icon: "icons/13.svg", name: "Reviewer", description: "Submit ratings for 5 different anime.", check: (stats) => stats.ratingsSubmitted >= 5, progress: (stats) => [stats.ratingsSubmitted, 5] },
  { id: "dedicated_viewer", icon: "icons/14.svg", name: "Dedicated Viewer", description: "Accumulate 24 hours of true watch time.", check: (stats) => stats.trueWatchSeconds >= 86400, progress: (stats) => [stats.trueWatchSeconds / 3600, 24] },
  { id: "level_10", icon: "icons/15.svg", name: "Level 10 Reached", description: "Reach RPG Level 10.", check: (stats) => stats.level >= 10, progress: (stats) => [stats.level, 10] },

  // ⚔️ MODERATE ACHIEVEMENTS (16-30)
  { id: "on_fire", icon: "icons/16.svg", name: "On Fire", description: "Hit a 10-day watching streak.", check: (stats) => stats.streak >= 10, progress: (stats) => [stats.streak, 10] },
  { id: "binge_watcher", icon: "icons/17.svg", name: "Binge Watcher", description: "Watch 7 episodes in a single calendar day.", check: (stats) => stats.episodesToday >= 7, progress: (stats) => [stats.episodesToday, 7] },
  { id: "half_century", icon: "icons/18.svg", name: "Half Century", description: "Watch 50 total episodes.", check: (stats) => stats.totalEpisodesTracked >= 50, progress: (stats) => [stats.totalEpisodesTracked, 50] },
  { id: "level_25", icon: "icons/19.svg", name: "Level 25 Reached", description: "Reach RPG Level 25.", check: (stats) => stats.level >= 25, progress: (stats) => [stats.level, 25] },
  { id: "seasoned_vet", icon: "icons/20.svg", name: "Seasoned Vet", description: "Finish 10 entire anime series.", check: (stats) => stats.completedSeries >= 10, progress: (stats) => [stats.completedSeries, 10] },
  { id: "half_day_saver", icon: "icons/21.svg", name: "Half-Day Saver", description: "Skip 12 hours worth of intros.", check: (stats) => stats.timeSavedSeconds >= 43200, progress: (stats) => [stats.timeSavedSeconds / 3600, 12] },
  { id: "century_mark", icon: "icons/22.svg", name: "Century Mark", description: "Watch 100 total episodes.", check: (stats) => stats.totalEpisodesTracked >= 100, progress: (stats) => [stats.totalEpisodesTracked, 100] },
  { id: "top_critic", icon: "icons/23.svg", name: "Top Critic", description: "Submit ratings for 20 different anime.", check: (stats) => stats.ratingsSubmitted >= 20, progress: (stats) => [stats.ratingsSubmitted, 20] },
  { id: "hundred_hours", icon: "icons/24.svg", name: "100 Hours", description: "Accumulate 100 hours of true watch time.", check: (stats) => stats.trueWatchSeconds >= 360000, progress: (stats) => [stats.trueWatchSeconds / 3600, 100] },
  { id: "unstoppable", icon: "icons/25.svg", name: "Unstoppable", description: "Hit a 30-day watching streak.", check: (stats) => stats.streak >= 30, progress: (stats) => [stats.streak, 30] },
  { id: "level_50", icon: "icons/26.svg", name: "Level 50 Reached", description: "Reach RPG Level 50.", check: (stats) => stats.level >= 50, progress: (stats) => [stats.level, 50] },
  { id: "library_builder", icon: "icons/27.svg", name: "Library Builder", description: "Finish 25 entire anime series.", check: (stats) => stats.completedSeries >= 25, progress: (stats) => [stats.completedSeries, 25] },
  { id: "anime_marathon", icon: "icons/28.svg", name: "Anime Marathon", description: "Watch 12 episodes in a single calendar day.", check: (stats) => stats.episodesToday >= 12, progress: (stats) => [stats.episodesToday, 12] },
  { id: "two_fifty", icon: "icons/29.svg", name: "Two-Fifty", description: "Watch 250 total episodes.", check: (stats) => stats.totalEpisodesTracked >= 250, progress: (stats) => [stats.totalEpisodesTracked, 250] },
  { id: "quarter_k", icon: "icons/30.svg", name: "Quarter-K", description: "Accumulate 250 hours of true watch time.", check: (stats) => stats.trueWatchSeconds >= 900000, progress: (stats) => [stats.trueWatchSeconds / 3600, 250] },

  // 👑 HARDCORE ACHIEVEMENTS (31-40)
  { id: "time_wizard_max", icon: "icons/31.svg", name: "Time Wizard", description: "Skip 24 entire hours worth of intros.", check: (stats) => stats.timeSavedSeconds >= 86400, progress: (stats) => [stats.timeSavedSeconds / 3600, 24] },
  { id: "five_hundred_club", icon: "icons/32.svg", name: "500 Club", description: "Watch 500 total episodes.", check: (stats) => stats.totalEpisodesTracked >= 500, progress: (stats) => [stats.totalEpisodesTracked, 500] },
  { id: "otaku_status", icon: "icons/33.svg", name: "Otaku Status", description: "Finish 50 entire anime series.", check: (stats) => stats.completedSeries >= 50, progress: (stats) => [stats.completedSeries, 50] },
  { id: "daily_ritual", icon: "icons/34.svg", name: "Daily Ritual", description: "Hit a 100-day watching streak.", check: (stats) => stats.streak >= 100, progress: (stats) => [stats.streak, 100] },
  { id: "level_75", icon: "icons/35.svg", name: "Level 75 Reached", description: "Reach RPG Level 75.", check: (stats) => stats.level >= 75, progress: (stats) => [stats.level, 75] },
  { id: "thousand_hours", icon: "icons/36.svg", name: "1,000 Hours", description: "Accumulate 1,000 hours of true watch time.", check: (stats) => stats.trueWatchSeconds >= 3600000, progress: (stats) => [stats.trueWatchSeconds / 3600, 1000] },
  { id: "completionist", icon: "icons/37.svg", name: "Completionist", description: "Finish 100 entire anime series.", check: (stats) => stats.completedSeries >= 100, progress: (stats) => [stats.completedSeries, 100] },
  { id: "millennium", icon: "icons/38.svg", name: "Millennium", description: "Watch 1,000 total episodes.", check: (stats) => stats.totalEpisodesTracked >= 1000, progress: (stats) => [stats.totalEpisodesTracked, 1000] },
  { id: "the_grind", icon: "icons/39.svg", name: "The Grind", description: "Accumulate 50,000 minutes watched.", check: (stats) => stats.trueWatchSeconds >= 3000000, progress: (stats) => [stats.trueWatchSeconds / 60, 50000] },
  { id: "legend_of_anime", icon: "icons/40.svg", name: "Legend of Anime", description: "Reach MAX Level (100).", check: (stats) => stats.level >= 100, progress: (stats) => [stats.level, 100] },

  // 📚 MANGA ACHIEVEMENTS (41-60)
  { id: "page_turner", icon: "icons/m01.svg", name: "Page Turner", description: "Read your first manga chapter.", check: (stats) => stats.totalChaptersTracked >= 1, progress: (stats) => [stats.totalChaptersTracked || 0, 1] },
  { id: "casual_reader", icon: "icons/m02.svg", name: "Casual Reader", description: "Read 10 manga chapters.", check: (stats) => stats.totalChaptersTracked >= 10, progress: (stats) => [stats.totalChaptersTracked || 0, 10] },
  { id: "first_volume", icon: "icons/m03.svg", name: "First Volume", description: "Finish reading an entire manga series.", check: (stats) => stats.completedManga >= 1, progress: (stats) => [stats.completedManga || 0, 1] },
  { id: "manga_critic", icon: "icons/m04.svg", name: "Manga Critic", description: "Rate a completed manga using the popup.", check: (stats) => stats.mangaRatingsSubmitted >= 1, progress: (stats) => [stats.mangaRatingsSubmitted || 0, 1] },
  { id: "chapter_binge", icon: "icons/m05.svg", name: "Chapter Binge", description: "Read 10 chapters in a single day.", check: (stats) => stats.chaptersToday >= 10, progress: (stats) => [stats.chaptersToday || 0, 10] },
  { id: "manga_enthusiast", icon: "icons/m06.svg", name: "Manga Enthusiast", description: "Read 50 manga chapters.", check: (stats) => stats.totalChaptersTracked >= 50, progress: (stats) => [stats.totalChaptersTracked || 0, 50] },
  { id: "bookshelf_started", icon: "icons/m07.svg", name: "Bookshelf Started", description: "Finish 5 entire manga series.", check: (stats) => stats.completedManga >= 5, progress: (stats) => [stats.completedManga || 0, 5] },
  { id: "speed_reader", icon: "icons/m08.svg", name: "Speed Reader", description: "Read 25 chapters in a single day.", check: (stats) => stats.chaptersToday >= 25, progress: (stats) => [stats.chaptersToday || 0, 25] },
  { id: "century_reader", icon: "icons/m09.svg", name: "Century Reader", description: "Read 100 manga chapters.", check: (stats) => stats.totalChaptersTracked >= 100, progress: (stats) => [stats.totalChaptersTracked || 0, 100] },
  { id: "manga_reviewer", icon: "icons/m10.svg", name: "Manga Reviewer", description: "Submit ratings for 10 different manga.", check: (stats) => stats.mangaRatingsSubmitted >= 10, progress: (stats) => [stats.mangaRatingsSubmitted || 0, 10] },
  { id: "avid_collector", icon: "icons/m11.svg", name: "Avid Collector", description: "Finish 15 entire manga series.", check: (stats) => stats.completedManga >= 15, progress: (stats) => [stats.completedManga || 0, 15] },
  { id: "two_fifty_chapters", icon: "icons/m12.svg", name: "250 Chapters", description: "Read 250 total chapters.", check: (stats) => stats.totalChaptersTracked >= 250, progress: (stats) => [stats.totalChaptersTracked || 0, 250] },
  { id: "sleepless_reader", icon: "icons/m13.svg", name: "Sleepless Reader", description: "Read a chapter between 2:00 AM and 5:00 AM.", check: (stats) => stats.hourOfDay >= 2 && stats.hourOfDay < 5 },
  { id: "manga_marathon", icon: "icons/m14.svg", name: "Manga Marathon", description: "Read 50 chapters in a single day.", check: (stats) => stats.chaptersToday >= 50, progress: (stats) => [stats.chaptersToday || 0, 50] },
  { id: "five_hundred_pages", icon: "icons/m15.svg", name: "500 Club (Manga)", description: "Read 500 total chapters.", check: (stats) => stats.totalChaptersTracked >= 500, progress: (stats) => [stats.totalChaptersTracked || 0, 500] },
  { id: "curator", icon: "icons/m16.svg", name: "Curator", description: "Finish 30 entire manga series.", check: (stats) => stats.completedManga >= 30, progress: (stats) => [stats.completedManga || 0, 30] },
  { id: "top_manga_critic", icon: "icons/m17.svg", name: "Top Manga Critic", description: "Submit ratings for 25 different manga.", check: (stats) => stats.mangaRatingsSubmitted >= 25, progress: (stats) => [stats.mangaRatingsSubmitted || 0, 25] },
  { id: "thousand_chapters", icon: "icons/m18.svg", name: "1,000 Chapters", description: "Read 1,000 total chapters.", check: (stats) => stats.totalChaptersTracked >= 1000, progress: (stats) => [stats.totalChaptersTracked || 0, 1000] },
  { id: "library_master", icon: "icons/m19.svg", name: "Library Master", description: "Finish 75 entire manga series.", check: (stats) => stats.completedManga >= 75, progress: (stats) => [stats.completedManga || 0, 75] },
  { id: "manga_god", icon: "icons/m20.svg", name: "Manga God", description: "Read 5,000 total chapters.", check: (stats) => stats.totalChaptersTracked >= 5000, progress: (stats) => [stats.totalChaptersTracked || 0, 5000] }
];

// 2. THIS MAKES IT ACCESSIBLE TO YOUR POPUP SCRIPTS!
if (typeof window !== 'undefined') {
    window.ACHIEVEMENTS = ACHIEVEMENTS;
}