import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-08-16",
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    // Connect to database first
    await connectMongo();
    console.log("⚡️ Stripe webhook received");

    // Get the raw request body
    const payload = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
      console.error("❌ No Stripe signature found in webhook request");
      return NextResponse.json({ error: "No Stripe signature" }, { status: 400 });
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error("❌ STRIPE_WEBHOOK_SECRET is not configured");
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        payload,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err: any) {
      console.error("❌ Error verifying webhook signature:", err.message);
      return NextResponse.json(
        { error: `Webhook signature verification failed: ${err.message}` },
        { status: 400 }
      );
    }

    console.log(`✅ Processing Stripe event: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("💰 Processing checkout completion for session:", session.id);

        const customerId = session.customer as string;
        
        // Find the user and update their plan
        const user = await User.findOne({ customerId });

        if (user) {
          console.log(`📝 Found user ${user._id} with email ${user.email}, updating to pro plan...`);
          user.plan = "pro";
          await user.save();
          console.log(`✨ Updated user ${user._id} to pro plan successfully`);
        } else {
          // If we can't find by customerId, try to find by client_reference_id
          if (session.client_reference_id) {
            const userById = await User.findById(session.client_reference_id);
            if (userById) {
              console.log(`📝 Found user by client_reference_id ${userById._id}, updating to pro plan...`);
              userById.plan = "pro";
              userById.customerId = customerId;
              await userById.save();
              console.log(`✨ Updated user ${userById._id} to pro plan successfully`);
            } else {
              console.error(`❌ No user found with client_reference_id ${session.client_reference_id}`);
            }
          } else {
            console.error(`❌ No user found with customerId ${customerId} and no client_reference_id available`);
          }
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("❌ Error in Stripe webhook handler:", error.message);
    return NextResponse.json(
      { error: `Webhook processing failed: ${error.message}` },
      { status: 500 }
    );
  }
}
