// API service for communicating with the Python trading bot backend
const API_BASE_URL = 'http://localhost:8000/api';

export interface TradingSymbol {
  symbol: string;
  name: string;
  token: number;
  exchange: string;
  is_nifty50: boolean;
  is_banknifty: boolean;
}

export interface ApiResponse<T> {
  status: 'success' | 'error' | 'info' | 'requires_login';
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

export interface TradingSettings {
  dry_run: boolean;
  fixed_capital_per_trade: number;
  risk_percent: number;
  leverage: number;
  position_sizing: 'fixed_capital' | 'fixed_risk';
}

class TradingApiService {
  private async makeRequest<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API request failed for ${endpoint}:`, error);
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  // Authentication
  async login(requestToken?: string): Promise<ApiResponse<{ user_id: string; login_url?: string }>> {
    return this.makeRequest('/login', {
      method: 'POST',
      body: JSON.stringify({ request_token: requestToken }),
    });
  }

  async testConnection(): Promise<ApiResponse<{ user_id: string; user_name: string }>> {
    return this.makeRequest('/test_connection');
  }

  // Instruments
  async getInstruments(): Promise<ApiResponse<{
    instruments: TradingSymbol[];
    nifty50_stocks: string[];
    banknifty_stocks: string[];
    count: number;
  }>> {
    return this.makeRequest('/instruments');
  }

  // Live Trading
  async startLiveTrading(symbols: TradingSymbol[]): Promise<ApiResponse<{ symbols: string[] }>> {
    return this.makeRequest('/start_live_trading', {
      method: 'POST',
      body: JSON.stringify({ symbols }),
    });
  }

  async stopLiveTrading(): Promise<ApiResponse<{}>> {
    return this.makeRequest('/stop_live_trading', {
      method: 'POST',
    });
  }

  async getLiveStatus(): Promise<ApiResponse<{ live_status: LiveStatus }>> {
    return this.makeRequest('/live_status');
  }

  // Settings
  async updateSettings(settings: Partial<TradingSettings>): Promise<ApiResponse<{}>> {
    return this.makeRequest('/update_settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  }

  // Export
  async exportTrades(trades: any[]): Promise<ApiResponse<Blob>> {
    try {
      const response = await fetch(`${API_BASE_URL}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trades }),
      });

      if (response.ok) {
        const blob = await response.blob();
        return { status: 'success', data: blob };
      } else {
        const error = await response.json();
        return { status: 'error', message: error.message };
      }
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Export failed'
      };
    }
  }
}

export const tradingApi = new TradingApiService();