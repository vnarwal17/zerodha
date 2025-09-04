import { createClient } from '@supabase/supabase-js';

export interface TradingSymbol {
  symbol: string;
  name: string;
  token: number;
  exchange: string;
  is_nifty50: boolean;
  is_banknifty: boolean;
}

export interface ApiResponse<T> {
  status: 'success' | 'error' | 'info' | 'requires_login' | 'connected' | 'disconnected';
  message?: string;
  data?: T;
  [key: string]: any;
}

export interface LiveStatus {
  market_open: boolean;
  active_positions: number;
  total_positions: number;
  monitoring_symbols: number;
  positions_detail: Array<{
    symbol: string;
    direction: 'long' | 'short';
    entry_price: number;
    current_price: number;
    stop_loss: number;
    target: number;
    quantity: number;
    status: string;
    unrealized_pnl: number;
    entry_time: string;
    exit_time?: string;
    exit_reason?: string;
  }>;
  strategy_logs: Array<{
    timestamp: string;
    symbol: string;
    event: string;
    message: string;
  }>;
}

export interface StrategySignal {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  price: number;
  quantity: number;
  reason: string;
}

export interface CandleData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradingSettings {
  dry_run: boolean;
  fixed_capital_per_trade: number;
  risk_percent: number;
  leverage: number;
  position_sizing: 'fixed_capital' | 'fixed_risk';
  // Zerodha-specific order parameters
  product: 'MIS' | 'CNC' | 'NRML'; // Margin product
  validity: 'DAY' | 'IOC' | 'TTL'; // Order validity
  market_protection: number; // Market protection percentage (-1 for auto, 0 for none, 1-100 for custom)
  disclosed_quantity?: number; // Quantity to disclose publicly
  tag?: string; // Order tag (alphanumeric, max 20 chars)
}

export interface TradeLog {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  order_id?: string;
  order_type: string;
  status: string;
  timestamp: string;
  created_at: string;
}

class TradingApiService {
  private supabase = createClient(
    'https://gvkfqovfzguyslvdudqw.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2a2Zxb3Zmemd1eXNsdmR1ZHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwMDUxNzMsImV4cCI6MjA3MjU4MTE3M30.YpfN1WDZsjlUwJuvhZlSskCbsTG-DURuowZGADR7h9Q'
  );

  private async callEdgeFunction<T>(path: string, data?: any): Promise<ApiResponse<T>> {
    try {
      const { data: result, error } = await this.supabase.functions.invoke('trading-api', {
        body: { path, ...data }
      });

      if (error) {
        console.error(`Edge function error for ${path}:`, error);
        return {
          status: 'error',
          message: error.message || 'Unknown error occurred'
        };
      }

      return result;
    } catch (error) {
      console.error(`API request failed for ${path}:`, error);
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to connect to backend server'
      };
    }
  }

  // Credentials
  async setCredentials(apiKey: string, apiSecret: string): Promise<ApiResponse<{}>> {
    return this.callEdgeFunction('/set_credentials', { api_key: apiKey, api_secret: apiSecret });
  }

  // Authentication
  async login(requestToken?: string): Promise<ApiResponse<{ user_id: string; user_name?: string; login_url?: string }>> {
    return this.callEdgeFunction('/login', { request_token: requestToken });
  }

  async testConnection(): Promise<ApiResponse<{ user_id: string; user_name: string; status?: string }>> {
    return this.callEdgeFunction('/test_connection');
  }

  // Instruments
  async getInstruments(): Promise<ApiResponse<{
    instruments: TradingSymbol[];
    nifty50_stocks: string[];
    banknifty_stocks: string[];
    count: number;
  }>> {
    return this.callEdgeFunction('/instruments');
  }

  // Live Trading
  async startLiveTrading(symbols: TradingSymbol[]): Promise<ApiResponse<{ symbols: string[] }>> {
    return this.callEdgeFunction('/start_live_trading', { symbols });
  }

  async stopLiveTrading(): Promise<ApiResponse<{}>> {
    return this.callEdgeFunction('/stop_live_trading');
  }

  async getLiveStatus(): Promise<ApiResponse<{ live_status: LiveStatus }>> {
    return this.callEdgeFunction('/live_status');
  }

  // Balance
  async getBalance(): Promise<ApiResponse<{ balance: any; user_id: string }>> {
    return this.callEdgeFunction('/get_balance');
  }

  // Settings
  async updateSettings(settings: Partial<TradingSettings>): Promise<ApiResponse<{}>> {
    return this.callEdgeFunction('/update_settings', settings);
  }

  // Strategy & Trading
  async getHistoricalData(symbol: string, instrumentToken: number, interval: string = '3minute', days: number = 30): Promise<ApiResponse<{
    symbol: string;
    candles: CandleData[];
    signal: StrategySignal;
    count: number;
  }>> {
    return this.callEdgeFunction('/get_historical_data', { 
      symbol, 
      instrument_token: instrumentToken, 
      interval, 
      days 
    });
  }

  async executeTrade(symbol: string, action: 'BUY' | 'SELL', quantity: number, orderType: string = 'MARKET'): Promise<ApiResponse<{
    order_id: string;
    symbol: string;
    action: string;
    quantity: number;
  }>> {
    return this.callEdgeFunction('/execute_trade', { 
      trade_symbol: symbol, 
      action, 
      quantity, 
      order_type: orderType 
    });
  }

  async analyzeSymbols(symbols: TradingSymbol[]): Promise<ApiResponse<{
    signals: StrategySignal[];
    timestamp: string;
    analyzed_count: number;
  }>> {
    return this.callEdgeFunction('/analyze_symbols', { monitoring_symbols: symbols });
  }

  // Export
  async exportTrades(trades: any[]): Promise<ApiResponse<Blob>> {
    try {
      const csvContent = this.convertToCSV(trades);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      return {
        status: 'success',
        message: 'Export completed',
        data: blob
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Export failed'
      };
    }
  }

  private convertToCSV(data: any[]): string {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(header => row[header]).join(','))
    ].join('\n');
    
    return csvContent;
  }
}

export const tradingApi = new TradingApiService();