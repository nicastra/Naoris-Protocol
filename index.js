import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import cloudscraper from "cloudscraper";
import banner from "./utils/banner.js";
import readline from "readline";

class DeviceHeartbeatBot {
  constructor(account, proxyConfig = null) {
    this.account = account;
    this.proxyConfig = proxyConfig;
    this.baseUrls = {
      secApi: "https://naorisprotocol.network/sec-api/api",
      testnetApi: "https://naorisprotocol.network/testnet-api/api/testnet",
    };
    this.uptimeMinutes = 0;
    this.deviceHash = account.deviceHash;
    this.toggleState = true;
    this.whitelistedUrls = ["naorisprotocol.network", "google.com"];
    this.isInstalled = true;

    if (proxyConfig) {
      console.log(chalk.blue(`[📡] Running with proxy: ${proxyConfig}`));
    } else {
      console.log(chalk.yellow(`[⚠️] Running without proxy`));
    }
  }

  static async loadAccounts(
    configPath = path.join(process.cwd(), "accounts.json")
  ) {
    try {
      const configData = await fs.readFile(configPath, "utf8");
      return JSON.parse(configData);
    } catch (error) {
      console.error(chalk.red("Failed to load accounts:"), error.message);
      process.exit(1);
    }
  }

  static async loadProxies(proxyPath = path.join(process.cwd(), "proxy.txt")) {
    try {
      const proxyData = await fs.readFile(proxyPath, "utf8");
      return proxyData.split("\n").filter((line) => line.trim());
    } catch (error) {
      console.error(chalk.red("Failed to load proxies:"), error.message);
      return [];
    }
  }

  getRequestConfig() {
    const config = {
      headers: {
        Authorization: `Bearer ${this.account.token}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        Referer: this.baseUrls.secApi,
        "Content-Type": "application/json",
      },
    };

    if (this.proxyConfig) {
      config.proxy = this.proxyConfig;
    }

    return config;
  }

  async toggleDevice(state = "ON") {
    try {
      console.log(`Toggle state (${state}) sending to backend...`);
      const payload = {
        walletAddress: this.account.walletAddress,
        state: state,
        deviceHash: this.deviceHash,
      };

      const response = await cloudscraper.post(
        `${this.baseUrls.secApi}/toggle`,
        {
          json: payload,
          headers: this.getRequestConfig().headers,
          proxy: this.proxyConfig,
        }
      );

      this.toggleState = state === "ON";
      this.logSuccess("Device Toggle", response);
      console.log(`Toggle state (${state}) sent to backend.`);
    } catch (error) {
      this.logError("Toggle Error", error);
    }
  }

  async sendHeartbeat() {
    try {
      console.log("Message production initiated");
      const payload = {
        topic: "device-heartbeat",
        inputData: {
          walletAddress: this.account.walletAddress,
          deviceHash: this.deviceHash.toString(),
          isInstalled: this.isInstalled,
          toggleState: this.toggleState,
          whitelistedUrls: this.whitelistedUrls,
        },
      };

      const response = await cloudscraper.post(
        `${this.baseUrls.secApi}/produce-to-kafka`,
        {
          json: payload,
          headers: this.getRequestConfig().headers,
          proxy: this.proxyConfig,
        }
      );

      console.log("Heartbeat sent to backend.");
      this.logSuccess("Heartbeat", response);
    } catch (error) {
      this.logError("Heartbeat Error", error);
    }
  }

  async getWalletDetails() {
    try {
      const payload = {
        walletAddress: this.account.walletAddress,
      };

      const response = await cloudscraper.post(
        `${this.baseUrls.testnetApi}/walletDetails`,
        {
          json: payload,
          headers: this.getRequestConfig().headers,
          proxy: this.proxyConfig,
        }
      );

      if (!response.error) {
        const details = response.details;
        this.logWalletDetails(details);
      } else {
        this.logError("Wallet Details", response);
      }
    } catch (error) {
      this.logError("Wallet Details Fetch", error);
    }
  }

  async startHeartbeatCycle() {
    try {
      await this.toggleDevice("ON");
      console.log("Installed script executed successfully!");
      await this.sendHeartbeat();

      let cycleCount = 0;
      const timer = setInterval(async () => {
        try {
          cycleCount++;
          this.uptimeMinutes++;

          if (cycleCount % 5 === 0) {
            console.log("Service worker wake-up alarm triggered.");
          }

          if (!this.toggleState) {
            await this.toggleDevice("ON");
          }

          await this.sendHeartbeat();
          await this.getWalletDetails();
          console.log(
            chalk.green(
              `[${new Date().toLocaleTimeString()}] Minute ${
                this.uptimeMinutes
              } completed`
            )
          );
        } catch (cycleError) {
          console.log("Heartbeat stopped.");
          this.logError("Heartbeat Cycle", cycleError);
          this.toggleState = false;
        }
      }, 60000);

      process.on("SIGINT", async () => {
        clearInterval(timer);
        await this.toggleDevice("OFF");
        console.log(
          chalk.yellow(
            "\nBot stopped. Final uptime:",
            this.uptimeMinutes,
            "minutes"
          )
        );
        process.exit();
      });
    } catch (error) {
      this.logError("Heartbeat Cycle Start", error);
    }
  }

  logSuccess(action, data) {
    console.log(chalk.green(`[✔] ${action} Success:`), data);
  }

  logError(action, error) {
    console.error(chalk.red(`[✖] ${action} Error:`), error.message || error);
  }

  logWalletDetails(details) {
    const earnings = this.uptimeMinutes * (details.activeRatePerMinute || 0);
    console.log(
      "\n" + chalk.white(`📊 Wallet Details for ${this.account.walletAddress}:`)
    );
    console.log(chalk.cyan(`  Total Earnings: ${details.totalEarnings}`));
    console.log(chalk.cyan(`  Today's Earnings: ${details.todayEarnings}`));
    console.log(
      chalk.cyan(
        `  Today's Referral Earnings: ${details.todayReferralEarnings}`
      )
    );
    console.log(
      chalk.cyan(`  Today's Uptime Earnings: ${details.todayUptimeEarnings}`)
    );
    console.log(
      chalk.cyan(`  Active Rate: ${details.activeRatePerMinute} per minute`)
    );
    console.log(
      chalk.cyan(`  Estimated Session Earnings: ${earnings.toFixed(4)}`)
    );
    console.log(chalk.cyan(`  Uptime: ${this.uptimeMinutes} minutes`));
    console.log(chalk.cyan(`  Rank: ${details.rank}\n`));
  }
}

async function askForProxyUsage() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(chalk.cyan("\n=== Proxy Configuration ==="));
    console.log(chalk.white("Do you want to use proxies? (y/n)"));
    rl.question("> ", async (answer) => {
      rl.close();
      if (answer.toLowerCase() === "y") {
        console.log(
          chalk.yellow(
            "\n[⚠️] Warning: Using proxies may cause Cloudflare errors"
          )
        );
        console.log(chalk.white("Press any key to continue..."));

        // Wait for any key press
        await new Promise((resolve) => {
          process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdin.once("data", () => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            resolve();
          });
        });

        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

async function main() {
  try {
    console.log(banner());
    const useProxy = await askForProxyUsage();
    const accounts = await DeviceHeartbeatBot.loadAccounts();

    let proxies = [];
    if (useProxy) {
      proxies = await DeviceHeartbeatBot.loadProxies();
      if (proxies.length === 0) {
        console.log(
          chalk.yellow(
            "[⚠️] No proxies found in proxy.txt, running without proxy"
          )
        );
      }
    }

    const bots = accounts.map((account, index) => {
      const proxy = proxies.length > 0 ? proxies[index % proxies.length] : null;
      return new DeviceHeartbeatBot(account, proxy);
    });

    for (const bot of bots) {
      bot.startHeartbeatCycle();
    }
  } catch (error) {
    console.error(chalk.red("Initialization Error:"), error);
  }
}

main();

export default DeviceHeartbeatBot;
