import Cloudflare, { CloudflareError } from "cloudflare";
import type { Zone } from "cloudflare/resources/zones/zones.mjs";

// Public IP address provider
const publicIpProvider = "https://ipecho.io/json";

// Cloudflare client
const CFClient = new Cloudflare({
  apiToken: process.env.CF_API_TOKEN!,
});

// Get your public IPv4 address as a string, example => "192.168.0.1"
const myPublicIp = await fetch(publicIpProvider)
  .then(
    async (response) => {
      const parsedResponse: unknown = await response.json();
      const data = parsedResponse as { ip: string };
      return data.ip;
    },
    (reason) => {
      console.info(
        "Fetch request to get public IP address rejected : ",
        reason
      );
      return undefined;
    }
  )
  .catch((err) => {
    console.error("Error occurred while fetching public IP Address : ", err);
    process.exit(1);
  });

// Get the first active Cloudflare zone which contains your domain name specified in environment variable (DOMAIN_NAME)
// Show error and exit process if not found.
let selectedZone: Zone | null = null;
const { result } = await CFClient.zones.list({
  name: process.env.DOMAIN_NAME!,
});
if (result.length > 0) {
  for (const zone of result) {
    if (zone.status == "active") {
      selectedZone = zone;
      break;
    }
  }
} else {
  console.error("No zones with the current domain found.");
  process.exit(1);
}
if (selectedZone == null) {
  console.error("No active zone with the current domain found.");
  process.exit(1);
}

// Select all the A records which exactly match the specified domain name in the environment variable (DOMAIN_NAME).
// Create A record if not found else update the record.
const totalDomain =
  process.env.SUBDOMAIN != undefined
    ? `${process.env.SUBDOMAIN}.${process.env.DOMAIN_NAME!}`
    : process.env.DOMAIN_NAME!;

const selectedDNSRecords = (
  await CFClient.dns.records.list({
    zone_id: selectedZone.id,
    name: {
      exact: totalDomain,
    },
  })
).result.filter((record) => record.type == "A");

console.log("Current IPv4 address of the local machine is : ", myPublicIp);
console.log("Total domain to set records for : ", totalDomain);

if (selectedDNSRecords.length > 0) {
  console.info("Existing records found! Updating them.");
  for (const record of selectedDNSRecords) {
    const updatedRecord = await CFClient.dns.records.edit(record.id, {
      zone_id: selectedZone.id,
      name: totalDomain,
      content: myPublicIp,
    });
    console.info("Updated record value : ", updatedRecord);
  }
} else {
  console.info("No records found! Creating them.");
  try {
    const newRecord = await CFClient.dns.records.create({
      zone_id: selectedZone.id,
      name: totalDomain,
      content: myPublicIp,
      type: "A",
      ttl: 1,
      proxied: true,
    });
    console.info("New record created : ", newRecord);
  } catch (err) {
    if (err instanceof CloudflareError) {
      console.error("Error occurred while creating records : ", err.message);
    } else {
      console.error("Unknown error occurred while creating records : ", err);
    }
  }
}
