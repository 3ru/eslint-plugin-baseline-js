import { transformerNotationErrorLevel } from "@shikijs/transformers";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins/rehype-code";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import { transformerTwoslash } from "fumadocs-twoslash";
import { createFileSystemTypesCache } from "fumadocs-twoslash/cache-fs";

export const docs = defineDocs({ dir: "content/docs" });

export default defineConfig({
  plugins: [lastModified()],
  mdxOptions: {
    rehypeCodeOptions: {
      ...rehypeCodeDefaultOptions,
      langs: ["ts", "js", "html", "tsx", "mdx"],
      inline: "tailing-curly-colon",
      transformers: [
        // Keep native line, word, diff, and focus annotations.
        ...(rehypeCodeDefaultOptions.transformers ?? []),
        transformerNotationErrorLevel({ matchAlgorithm: "v3" }),
        transformerTwoslash({
          typesCache: createFileSystemTypesCache(),
        }),
      ],
    },
  },
});
