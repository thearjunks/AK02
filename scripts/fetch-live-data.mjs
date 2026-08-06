import { refreshLiveData } from "../server.mjs";

try {
  const data = await refreshLiveData();
  if (!data?.generatedAt || data.fetchWarning) {
    throw new Error(data?.fetchWarning || "STC returned no generation timestamp.");
  }
  const currentDevices = (data.devices || []).filter((device) => device.deviceStatus !== "REMOVED");
  if (currentDevices.some((device) => !device.englishDetailLoaded || !device.arabicDetailLoaded || !device.englishPdpUrl || !device.arabicPdpUrl)) {
    throw new Error("One or more live devices are missing validated English or Arabic content pages.");
  }

  process.stdout.write(JSON.stringify({
    generatedAt: data.generatedAt,
    currentTotal: data.changeSummary?.currentTotal ?? data.devices?.length ?? 0,
    displayedTotal: data.changeSummary?.displayedTotal ?? data.devices?.length ?? 0,
    added: data.changeSummary?.added ?? 0,
    removed: data.changeSummary?.removed ?? 0,
    colors: data.colors?.length ?? 0,
    catalogSampleTotals: data.catalogSampleTotals || [],
    englishContent: currentDevices.filter((device) => device.englishDescription).length,
    arabicContent: currentDevices.filter((device) => device.arabicDescription).length,
  }));
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}
