/** Domain packs index for Prompt Token Saver. */
import { pack as sql } from "./token-saver-pack-sql";
import { pack as react } from "./token-saver-pack-react";
import { pack as devops } from "./token-saver-pack-devops";
import { pack as data } from "./token-saver-pack-data";
import { pack as ui } from "./token-saver-pack-ui";
import { pack as ux } from "./token-saver-pack-ux";

export const domainPacks: Record<string, Record<string, string>> = {
  "pack-sql": sql,
  "pack-react": react,
  "pack-devops": devops,
  "pack-data": data,
  "pack-ui": ui,
  "pack-ux": ux,
};
