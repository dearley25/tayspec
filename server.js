require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const Stripe = require("stripe");
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-password";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const DATA_FILE = path.join(__dirname, "data", "entries.json");

// ---------- Cloudflare R2 client (S3-compatible) ----------

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const PUBLIC_BUCKET = process.env.R2_BUCKET_NAME;
const PRIVATE_BUCKET = process.env.R2_PRIVATE_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

async function uploadToR2(file, bucket) {
  const key = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    })
  );
  return key;
}

async function deleteFromR2(key, bucket) {
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

async function presignedDownloadUrl(key) {
  const command = new GetObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key });
  return getSignedUrl(r2, command, { expiresIn: 600 }); // 10 minutes
}

// ---------- data helpers ----------

function readEntries() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function writeEntries(entries) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2));
}

function nextId(kind, entries) {
  const prefix = kind.toUpperCase();
  const count = entries.filter((e) => e.kind === kind).length + 1;
  return `${prefix}-${String(count).padStart(3, "0")}`;
}

// Strip private fields before sending an entry to the public catalog.
// A premium entry's real file key never reaches the browser until paid for.
function toPublic(entry) {
  const { fileKey, ...rest } = entry;
  if (entry.premium) {
    return { ...rest, fileUrl: null }; // no direct link — must go through checkout
  }
  return rest;
}

// ---------- multer: hold the file in memory, then hand it to R2 ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

// ---------- middleware ----------

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- catalog ----------

app.get("/api/entries", (req, res) => {
  res.json(readEntries().map(toPublic));
});

app.post("/api/entries", upload.single("file"), async (req, res) => {
  const { password, title, kind, summary, videoUrl, premium, priceDollars } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  if (!title || !kind || !summary) {
    return res.status(400).json({ error: "Title, kind, and summary are required." });
  }

  const isPremium = premium === "true" || premium === "on";
  const priceCents = isPremium ? Math.round(parseFloat(priceDollars || "0") * 100) : 0;

  if (isPremium && (!priceCents || priceCents < 50)) {
    return res.status(400).json({ error: "Premium entries need a price of at least $0.50." });
  }

  let fileUrl = null;
  let fileKey = null;

  try {
    if (req.file) {
      const bucket = isPremium ? PRIVATE_BUCKET : PUBLIC_BUCKET;
      fileKey = await uploadToR2(req.file, bucket);
      if (!isPremium) fileUrl = `${PUBLIC_URL}/${fileKey}`;
    }
  } catch (err) {
    console.error("R2 upload failed:", err);
    return res.status(500).json({ error: "File upload to storage failed. Check your R2 settings." });
  }

  const entries = readEntries();
  const id = nextId(kind, entries);

  const entry = {
    id,
    kind,
    title,
    summary,
    fileUrl,
    fileKey,
    videoUrl: videoUrl || null,
    premium: isPremium,
    priceCents: isPremium ? priceCents : 0,
    createdAt: new Date().toISOString()
  };

  entries.unshift(entry);
  writeEntries(entries);

  res.json({ success: true, entry: toPublic(entry) });
});

app.delete("/api/entries/:id", async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  const entries = readEntries();
  const entry = entries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Not found." });

  if (entry.fileKey) {
    try {
      await deleteFromR2(entry.fileKey, entry.premium ? PRIVATE_BUCKET : PUBLIC_BUCKET);
    } catch (err) {
      console.error("R2 delete failed:", err);
    }
  }

  writeEntries(entries.filter((e) => e.id !== req.params.id));
  res.json({ success: true });
});

// ---------- paid content: checkout + gated download ----------

// Start a Stripe Checkout session for one premium entry
app.post("/api/checkout", async (req, res) => {
  const { entryId } = req.body;
  const entry = readEntries().find((e) => e.id === entryId);

  if (!entry || !entry.premium) {
    return res.status(404).json({ error: "That item isn't available for purchase." });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: entry.title },
            unit_amount: entry.priceCents
          },
          quantity: 1
        }
      ],
      metadata: { entryId: entry.id },
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&entry=${entry.id}`,
      cancel_url: `${BASE_URL}/index.html`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout failed:", err);
    res.status(500).json({ error: "Could not start checkout. Check your Stripe key." });
  }
});

// After a successful payment, verify it with Stripe and hand back a
// short-lived download link — this is the only way the real file URL
// ever reaches the browser for premium content.
app.get("/api/download/:id", async (req, res) => {
  const { session_id } = req.query;
  const entry = readEntries().find((e) => e.id === req.params.id);

  if (!entry || !entry.premium) {
    return res.status(404).json({ error: "That item isn't available." });
  }
  if (!session_id) {
    return res.status(400).json({ error: "Missing checkout session." });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const paidForThisEntry =
      session.payment_status === "paid" && session.metadata.entryId === entry.id;

    if (!paidForThisEntry) {
      return res.status(403).json({ error: "Payment not confirmed for this item." });
    }

    const url = await presignedDownloadUrl(entry.fileKey);
    res.json({ url });
  } catch (err) {
    console.error("Download verification failed:", err);
    res.status(500).json({ error: "Could not verify payment." });
  }
});

app.listen(PORT, () => {
  console.log(`Field Spec running at ${BASE_URL}`);
});
