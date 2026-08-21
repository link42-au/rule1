import adapter from "@sveltejs/adapter-static";

const config = {
  kit: {
    adapter: adapter(),
    paths: {
      base: "/rule1",
    },
  },
};

export default config;
