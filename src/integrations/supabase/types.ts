export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      trade_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          order_id: string | null
          order_type: string | null
          price: number | null
          quantity: number
          status: string | null
          symbol: string
          timestamp: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          order_id?: string | null
          order_type?: string | null
          price?: number | null
          quantity: number
          status?: string | null
          symbol: string
          timestamp?: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          order_id?: string | null
          order_type?: string | null
          price?: number | null
          quantity?: number
          status?: string | null
          symbol?: string
          timestamp?: string
        }
        Relationships: []
      }
      trading_credentials: {
        Row: {
          api_key: string
          api_secret: string
          created_at: string
          encrypted_api_key: string | null
          encrypted_api_secret: string | null
          encryption_version: number | null
          id: number
          updated_at: string
        }
        Insert: {
          api_key: string
          api_secret: string
          created_at?: string
          encrypted_api_key?: string | null
          encrypted_api_secret?: string | null
          encryption_version?: number | null
          id?: number
          updated_at?: string
        }
        Update: {
          api_key?: string
          api_secret?: string
          created_at?: string
          encrypted_api_key?: string | null
          encrypted_api_secret?: string | null
          encryption_version?: number | null
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      trading_logs: {
        Row: {
          created_at: string
          id: string
          level: string | null
          message: string
          symbol: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          level?: string | null
          message: string
          symbol?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          level?: string | null
          message?: string
          symbol?: string | null
        }
        Relationships: []
      }
      trading_positions: {
        Row: {
          created_at: string
          current_price: number | null
          entry_price: number
          id: string
          pnl: number | null
          quantity: number
          status: string | null
          symbol: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_price?: number | null
          entry_price: number
          id?: string
          pnl?: number | null
          quantity: number
          status?: string | null
          symbol: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_price?: number | null
          entry_price?: number
          id?: string
          pnl?: number | null
          quantity?: number
          status?: string | null
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      trading_sessions: {
        Row: {
          access_token: string | null
          created_at: string
          id: number
          login_time: string | null
          request_token: string | null
          status: string | null
          symbols: Json | null
          trading_active: boolean | null
          updated_at: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          id?: number
          login_time?: string | null
          request_token?: string | null
          status?: string | null
          symbols?: Json | null
          trading_active?: boolean | null
          updated_at?: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          access_token?: string | null
          created_at?: string
          id?: number
          login_time?: string | null
          request_token?: string | null
          status?: string | null
          symbols?: Json | null
          trading_active?: boolean | null
          updated_at?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      trading_settings: {
        Row: {
          created_at: string
          id: number
          settings: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          settings?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          settings?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      migrate_credentials_to_encrypted: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
