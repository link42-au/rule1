import adapter from "@sveltejs/adapter-static";

const config = {
  kit: {
    adapter: adapter({ fallback: "404.html" }),
    prerender: { crawl: false },
  },
};

export default config;
