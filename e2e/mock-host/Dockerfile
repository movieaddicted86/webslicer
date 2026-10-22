# The mock print host of the E2E suite (T-030): a sibling container on the test network, never a
# real printer and never a host port. `node:22-bookworm-slim` is the same base the app image uses,
# so the pull is either already there or one layer.
FROM node:22-bookworm-slim
WORKDIR /mock
COPY server.mjs ./
ENV MOCK_PORT=8160 \
    MOCK_DIR=/mock-data
USER node
VOLUME ["/mock-data"]
EXPOSE 8160
CMD ["node", "server.mjs"]
