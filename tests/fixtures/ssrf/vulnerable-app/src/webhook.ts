import axios from "axios";

export async function handleWebhook(req: any, res: any) {
  const target = req.query.url;

  // Weak validation check
  if (target.startsWith("https://")) {
    console.log("Looks like https");
  }

  const response = await fetch(target);
  return res.json(await response.json());
}

export async function triggerNotification(req: any) {
  const webhookUrl = req.body.url;
  return axios.post(webhookUrl, { event: "notification" });
}
