import { AutoRouter } from 'itty-router';
import { neon } from '@neondatabase/serverless';
import * as cheerio from 'cheerio';

const router = AutoRouter();

// Database connection (using Neon PostgreSQL as example)
const getDb = (env) => neon(env.database);

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle CORS preflight requests
router.options('*', () => new Response(null, { headers: corsHeaders }));

// Scheduled cron job handler
router.get('/scheduled', async (request, env) => {
  try {
    console.log('Starting scheduled scrape job...');
    
    // Scrape FlixPatrol data
    const scrapedData = await scrapeFlixPatrol();
    
    // Filter for 2025 movies without streaming
    const filtered2025Movies = scrapedData.filter(movie => {
      const is2025 = movie.year === '2025';
      const hasNoStreaming = !movie.hasStreaming;
      return is2025 && hasNoStreaming;
    });

    // Store in database
    const sql = getDb(env);
    const stored = await storeMoviesInDatabase(sql, filtered2025Movies);

    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      totalScraped: scrapedData.length,
      filtered2025Count: filtered2025Movies.length,
      storedCount: stored,
      message: `Successfully scraped and stored ${stored} movies`
    };

    console.log('Scheduled job completed:', result);
    return Response.json(result);

  } catch (error) {
    console.error('Scheduled job failed:', error);
    return Response.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});

// Manual trigger endpoint for testing
router.get('/scrape-now', async (request, env) => {
  try {
    // Same logic as scheduled job but can be triggered manually
    const scrapedData = await scrapeFlixPatrol();
    
    const filtered2025Movies = scrapedData.filter(movie => {
      const is2025 = movie.year === '2025';
      const hasNoStreaming = !movie.hasStreaming;
      return is2025 && hasNoStreaming;
    });

    const sql = getDb(env);
    const stored = await storeMoviesInDatabase(sql, filtered2025Movies);

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalScraped: scrapedData.length,
      filtered2025Count: filtered2025Movies.length,
      storedCount: stored,
      movies: filtered2025Movies
    }, { headers: corsHeaders });

  } catch (error) {
    return Response.json({
      success: false,
      error: error.message
    }, { 
      status: 500,
      headers: corsHeaders 
    });
  }
});

// Get stored movies from database
router.get('/movies', async (request, env) => {
  try {
    const sql = getDb(env);
    const movies = await sql`
      SELECT * FROM movies 
      WHERE year = '2025' 
      AND has_streaming = false 
      ORDER BY updated_at DESC
    `;

    return Response.json({
      success: true,
      count: movies.length,
      movies: movies
    }, { headers: corsHeaders });

  } catch (error) {
    return Response.json({
      success: false,
      error: error.message
    }, { 
      status: 500,
      headers: corsHeaders 
    });
  }
});

// Get latest scrape statistics
router.get('/stats', async (request, env) => {
  try {
    const sql = getDb(env);
    const stats = await sql`
      SELECT 
        COUNT(*) as total_movies,
        MAX(updated_at) as last_updated
      FROM movies 
      WHERE year = '2025' AND has_streaming = false
    `;

    return Response.json({
      success: true,
      stats: stats[0]
    }, { headers: corsHeaders });

  } catch (error) {
    return Response.json({
      success: false,
      error: error.message
    }, { 
      status: 500,
      headers: corsHeaders 
    });
  }
});

// Health check endpoint
router.get('/health', () => {
  return Response.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  }, { headers: corsHeaders });
});

// Root endpoint with API documentation
router.get('/', () => {
  return Response.json({
    name: 'FlixPatrol Scraper Cron Job',
    description: 'Scrapes FlixPatrol every 2 hours for 2025 movies without streaming',
    endpoints: {
      '/scheduled': 'GET - Cron job endpoint (internal)',
      '/scrape-now': 'GET - Manual scrape trigger',
      '/movies': 'GET - Get stored movies',
      '/stats': 'GET - Get scrape statistics',
      '/health': 'GET - Health check'
    },
    schedule: 'Every 2 hours',
    database: 'PostgreSQL via Neon'
  }, { headers: corsHeaders });
});

// Main scraping function

async function scrapeFlixPatrol() {
  const response = await fetch('https://flixpatrol.com/popular/', {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const movies = [];
  console.log(html)

  $('tr.table-group').each((i, row) => {
    try {
      const movie = {};

      const title = $(row).find('img[alt]').attr('alt') || null;
      const posterSrc = $(row).find('img').attr('src') || '';
      const posterUrl = posterSrc ? `https://flixpatrol.com${posterSrc}` : null;
      const linkHref = $(row).find('a').attr('href') || '';
      const link = linkHref ? `https://flixpatrol.com${linkHref}` : null;

const premiereSpan = $(row).find('span[title="Premiere"]');
const fullDateText = premiereSpan.text().trim(); // "06/04/2025"
const year = fullDateText.split('/')[2] || null;
      const allSpans = $(row).find('span');
      const country = $(allSpans[2]).text().trim() || null;
      const genre = $(allSpans[4]).text().trim() || null;

      const rowText = $(row).text();
      console.log(rowText)
      const hasStreaming = /Netflix|Amazon|Disney|HBO|Hulu|Apple TV|streaming|Stream/i.test(rowText);
      const isMovie = rowText.includes('Movie');

      if (title && isMovie) {
        movie.title = title;
        movie.posterUrl = posterUrl;
        movie.link = link;
        movie.year = year;
        movie.country = country;
        movie.genre = genre;
        movie.hasStreaming = hasStreaming;
        movie.isMovie = true;

        movies.push(movie);
      }

    } catch (error) {
      console.log('Error parsing row:', error);
    }
  });
   console.log(movies)
  return movies;
}


// Parse movie data from HTML
function parseMovieData(html) {
  const movies = [];
  const movieRows = html.split('<tr class="table-group">').slice(1);
  
  movieRows.forEach(row => {
    try {
      const movie = {};
      
      // Skip rank extraction
      
      // Extract title
      const titleMatch = row.match(/alt="([^"]+)"/);
      movie.title = titleMatch ? titleMatch[1] : null;
      
      // Extract poster URL
      const posterMatch = row.match(/src="([^"]+\.jpg)"/);
      movie.posterUrl = posterMatch ? `https://flixpatrol.com${posterMatch[1]}` : null;
      
      // Extract movie link
      const linkMatch = row.match(/href="([^"]+)"/);
      movie.link = linkMatch ? `https://flixpatrol.com${linkMatch[1]}` : null;
      
      // Extract year from the date span
      const yearMatch = row.match(/<span class="text-gray-600">(\d{2})\/(\d{2})\/(\d{4})<\/span>/);
      movie.year = yearMatch ? yearMatch[3] : null;
      
      // Extract country
      const countryMatch = row.match(/<span>([^<]+)<\/span>\s*<span class="mx-1 text-gray-600 select-none">\|<\/span>\s*<span><span title="Premiere">/);
      movie.country = countryMatch ? countryMatch[1] : null;
      
      // Extract genre
      const genreMatch = row.match(/<span>([^<]+)<\/span>\s*<\/div><\/div>/);
      movie.genre = genreMatch ? genreMatch[1] : null;
      
      // Skip points extraction
      
      // Check if movie type is "Movie"
      const isMovie = row.includes('Movie');
      movie.isMovie = isMovie;
      
      // Check for streaming availability
      const hasStreaming = row.includes('Netflix') || 
                          row.includes('Amazon') || 
                          row.includes('Disney') || 
                          row.includes('HBO') || 
                          row.includes('Hulu') || 
                          row.includes('Apple TV') ||
                          row.includes('streaming') ||
                          row.includes('Stream');
      
      movie.hasStreaming = hasStreaming;
      
      // Only add if we have essential data and it's a movie
      if (movie.title && movie.isMovie) {
        movies.push(movie);
      }
      
    } catch (error) {
      console.log('Error parsing movie row:', error);
    }
  });
  
  return movies;
}

// Store movies in database
async function storeMoviesInDatabase(sql, movies) {
  let storedCount = 0;
  
  for (const movie of movies) {
    try {
      // Upsert movie (insert or update if exists)
      await sql`
        INSERT INTO movies (
          title, poster_url, link, year, country, genre, has_streaming, updated_at
        ) VALUES (
          ${movie.title}, ${movie.posterUrl}, ${movie.link}, 
          ${movie.year}, ${movie.country}, ${movie.genre}, 
          ${movie.hasStreaming}, NOW()
        )
        ON CONFLICT (title, year) 
        DO UPDATE SET 
          poster_url = EXCLUDED.poster_url,
          link = EXCLUDED.link,
          country = EXCLUDED.country,
          genre = EXCLUDED.genre,
          has_streaming = EXCLUDED.has_streaming,
          updated_at = NOW()
      `;
      storedCount++;
    } catch (error) {
      console.error(`Error storing movie ${movie.title}:`, error);
    }
  }
  
  return storedCount;
}

// Handle scheduled events (cron jobs)
async function handleScheduled(event, env) {
  console.log('Cron job triggered at:', new Date().toISOString());
  
  try {
    // Create a fake request to trigger the scheduled endpoint
    const request = new Request('https://workerbot.reddyindra53.workers.dev/scheduled');
    const response = await router.fetch(request, env);
    
    console.log('Cron job completed successfully');
    return response;
    
  } catch (error) {
    console.error('Cron job failed:', error);
    throw error;
  }
}

// Export the router and scheduled handler
export default {
  fetch: router.fetch,
  scheduled: handleScheduled
};