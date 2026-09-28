import fs from "node:fs";
import { config } from "./config.js";
import { addDnc, getDb } from "./db.js";
import { placeSalesCall } from "./dialer/dialer.js";
import { findLeads, importCsv } from "./leads/pipeline.js";
import { toE164 } from "./lib/util.js";
import { buildPreview, previewUrl } from "./preview/generate.js";
import { createStripeCatalog } from "./tools/stripe.js";
import { configureExistingNumber } from "./tools/twilio.js";

const HELP = `Rollinson AI command line

  npm run cli -- stripe:setup                 Create the Stripe products/prices; prints the .env lines
  npm run cli -- numbers:configure            Point the sales + demo Twilio numbers at this server
  npm run cli -- leads:find "<search>" [max]  e.g. "plumber in Elizabeth City, NC" 40
  npm run cli -- leads:import <file.csv>      Import leads from a CSV (name + phone columns)
  npm run cli -- dnc:import <file.txt>        Load numbers from a National DNC Registry download
  npm run cli -- preview <leadId>             Build a lead's preview site and print the link
  npm run cli -- call <leadId>                Have the AI call one lead now (compliance rules apply)
`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  getDb();
  switch (cmd) {
    case "stripe:setup": {
      const ids = await createStripeCatalog();
      console.log("Add these to your .env:\n");
      for (const [k, v] of Object.entries(ids)) console.log(`${k}=${v}`);
      break;
    }
    case "numbers:configure": {
      for (const n of [config.SALES_CALLER_ID, config.DEMO_LINE_NUMBER].filter(Boolean)) {
        await configureExistingNumber(n);
        console.log(`Configured ${n} -> ${config.PUBLIC_BASE_URL}`);
      }
      break;
    }
    case "leads:find": {
      if (!args[0]) throw new Error('Usage: leads:find "roofer in Elizabeth City, NC" [max]');
      console.log(await findLeads(args[0], Number(args[1]) || 40));
      break;
    }
    case "leads:import": {
      console.log(await importCsv(fs.readFileSync(args[0], "utf8")));
      break;
    }
    case "dnc:import": {
      const text = fs.readFileSync(args[0], "utf8");
      let n = 0;
      const insert = getDb().transaction((lines: string[]) => {
        for (const line of lines) {
          const phone = toE164(line.replace(/\D/g, ""));
          if (phone) {
            addDnc(phone, "National DNC Registry", "registry");
            n++;
          }
        }
      });
      insert(text.split(/\r?\n/));
      console.log(`Loaded ${n} numbers into the do-not-call list.`);
      break;
    }
    case "preview": {
      const lead = await buildPreview(Number(args[0]));
      console.log(previewUrl(lead));
      break;
    }
    case "call": {
      console.log(await placeSalesCall(Number(args[0])));
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
