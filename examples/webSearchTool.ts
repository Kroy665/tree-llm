import type { ToolDefinition } from 'tree-llm';

const TAVILY_API_URL = 'https://api.tavily.com/search';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  favicon?: string;
}

interface TavilyResponse {
  query: string;
  answer?: string;
  results: TavilyResult[];
  response_time: number;
}

const webSearchTool: ToolDefinition = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web in real-time. Use this for current events, factual lookups, news, finance, or any query that benefits from up-to-date web results. ' +
        'Returns a list of results with title, URL, and a short snippet. For deeper information, follow up by calling fetch_url on the most relevant result URLs to scrape the full page content.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            description: 'The search query.',
          },
          search_depth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description:
              'basic (fast) or advanced (deeper crawl). Default: basic.',
          },
          topic: {
            type: 'string',
            enum: ['general', 'news', 'finance'],
            description: 'Search category. Default: general.',
          },
          max_results: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            description: 'Number of results to return (1–10). Default: 5.',
          },
          time_range: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year'],
            description: 'Filter results by recency. Optional.',
          },
          include_answer: {
            type: 'boolean',
            description:
              'If true, returns a short AI-generated answer synthesised from results. Default: false.',
          },
          include_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only return results from these domains. Optional.',
          },
          exclude_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exclude results from these domains. Optional.',
          },
        },
      },
    },
  },

  handler: async (args) => {
    const apiKey = process.env.TAVILY_API_KEY;
    console.log('API Key:', apiKey);
    if (!apiKey) {
      return { error: 'Web search is not configured on this server.' };
    }

    const {
      query,
      search_depth = 'basic',
      topic = 'general',
      max_results = 5,
      time_range,
      include_answer = false,
      include_domains,
      exclude_domains,
    } = args as {
      query: string;
      search_depth?: 'basic' | 'advanced';
      topic?: 'general' | 'news' | 'finance';
      max_results?: number;
      time_range?: 'day' | 'week' | 'month' | 'year';
      include_answer?: boolean;
      include_domains?: string[];
      exclude_domains?: string[];
    };

    const payload: Record<string, unknown> = {
      query,
      search_depth,
      topic,
      max_results,
      include_answer,
      include_favicon: false,
    };
    if (time_range) payload.time_range = time_range;
    if (include_domains?.length) payload.include_domains = include_domains;
    if (exclude_domains?.length) payload.exclude_domains = exclude_domains;

    let data: TavilyResponse;
    try {
      const resp = await fetch(TAVILY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });

      if (!resp.ok) {
        const text = await resp.text();
        let msg = `Web search failed (HTTP ${resp.status})`;
        try {
          const err = JSON.parse(text);
          if (err.detail) msg = `Web search error: ${err.detail}`;
        } catch { /* use raw */ }
        return { error: msg };
      }

      data = await resp.json() as TavilyResponse;
    } catch (err) {
      return { error: `Web search failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    const formatted = data.results.map((r, i) => ({
      index: i + 1,
      title: r.title,
      url: r.url,
      score: Math.round(r.score * 100) / 100,
      snippet: r.content,
    }));

    return {
      query: data.query,
      ...(data.answer ? { answer: data.answer } : {}),
      results: formatted,
      result_count: formatted.length,
      response_time_s: data.response_time,
    };
  },
};

export default webSearchTool;
