import adapter from "@sveltejs/adapter-static";

const config = {
  kit: {
    adapter: adapter({ fallback: "404.html" }),
    paths: {
      base: "/rule1",
    },
    prerender: { crawl: false },
  },
};

export default config;
