import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

// This endpoint mutates data (it relinks subscriptions to the current user),
// so it is exposed as POST rather than GET to avoid being triggerable via a
// cross-site GET request.
export async function POST(/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  request: NextRequest) {
  try {
    // Get authenticated user
    const authResult = await auth();
    const userId = authResult.userId;
    const userEmail = authResult.sessionClaims?.email as string;
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!userEmail) {
      return NextResponse.json({ error: "No email found for current user" }, { status: 400 });
    }

    // Create admin Supabase client to bypass RLS
    const adminClient = createAdminSupabaseClient();
    
    // 1. First check if user has any subscriptions linked to their ID
    const { data: existingSubscriptions } = await adminClient
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId);
      
    if (existingSubscriptions && existingSubscriptions.length > 0) {
      return NextResponse.json({
        success: false,
        message: "User already has subscriptions linked to their ID",
        subscriptions: existingSubscriptions
      });
    }
    
    // 2. Find the profile that owns this email (profiles is keyed by user_id)
    const { data: users, error: userError } = await adminClient
      .from('profiles')
      .select('user_id, email')
      .eq('email', userEmail);
      
    if (userError) {
      return NextResponse.json({ 
        error: "Error finding user by email", 
        details: userError 
      }, { status: 500 });
    }
    
    if (!users || users.length === 0) {
      return NextResponse.json({ 
        error: "No user found with this email in the database" 
      }, { status: 404 });
    }
    
    // 3. Find any subscriptions linked to this email but with different user_id
    const { data: subscriptions, error: subError } = await adminClient
      .from('subscriptions')
      .select('*')
      .eq('user_id', users[0].user_id);

    if (subError) {
      return NextResponse.json({ 
        error: "Error finding subscriptions", 
        details: subError 
      }, { status: 500 });
    }
    
    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ 
        error: "No subscriptions found linked to this email" 
      }, { status: 404 });
    }
    
    // 4. Update the subscriptions to use the new Clerk user ID
    const { data: updateResult, error: updateError } = await adminClient
      .from('subscriptions')
      .update({ user_id: userId })
      .eq('user_id', users[0].user_id)
      .select();
      
    if (updateError) {
      return NextResponse.json({ 
        error: "Error updating subscription user IDs", 
        details: updateError 
      }, { status: 500 });
    }
    
    return NextResponse.json({
      success: true,
      message: "Successfully updated subscription user IDs",
      updated: updateResult,
      fromUserId: users[0].user_id,
      toUserId: userId
    });
  } catch (error) {
    console.error("Error in fix-user-id route:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
} 