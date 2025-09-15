import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Save, RotateCcw } from "lucide-react";
import { useState } from "react";
import { tradingApi, TradingSettings } from "@/services/trading-api";
import { useToast } from "@/hooks/use-toast";

interface TradingSettingsProps {
  isConnected: boolean;
}

export function TradingSettingsComponent({ isConnected }: TradingSettingsProps) {
  const [settings, setSettings] = useState<TradingSettings>({
    quantity: 2, // Default quantity
    fixed_capital_per_trade: 100000,
    risk_percent: 2,
    leverage: 1,
    position_sizing: 'fixed_capital',
    product: 'MIS', // Intraday
    validity: 'DAY', // Day order
    market_protection: -1, // Auto protection
    disclosed_quantity: 0,
    tag: 'ALGO_TRADE',
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSettingChange = (key: keyof TradingSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveSettings = async () => {
    if (!isConnected) {
      toast({
        title: "Connection Required",
        description: "Please connect to your broker first.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await tradingApi.updateSettings(settings);
      if (response.status === 'success') {
        toast({
          title: "Settings Saved",
          description: "Trading settings have been updated successfully.",
        });
      } else {
        toast({
          title: "Save Failed",
          description: response.message || "Failed to save settings",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const resetToDefaults = () => {
    setSettings({
      quantity: 2,
      fixed_capital_per_trade: 100000,
      risk_percent: 2,
      leverage: 1,
      position_sizing: 'fixed_capital',
      product: 'MIS',
      validity: 'DAY',
      market_protection: -1,
      disclosed_quantity: 0,
      tag: 'ALGO_TRADE',
    });
    toast({
      title: "Settings Reset",
      description: "All settings have been reset to defaults.",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Settings className="h-5 w-5 text-primary" />
          <span>Live Trading Settings</span>
        </CardTitle>
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
          <span className="text-sm font-medium text-red-700">
            ⚠️ LIVE TRADING MODE - All orders will be executed with real money
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Quantity Configuration */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Quantity per Trade</Label>
            <Input
              type="number"
              min="1"
              max="10000"
              value={settings.quantity}
              onChange={(e) => handleSettingChange('quantity', parseInt(e.target.value) || 2)}
              placeholder="2"
              className="bg-input border-border text-foreground"
            />
            <p className="text-sm text-muted-foreground">
              Number of shares/units to trade per signal (default: 2)
            </p>
          </div>

          <div className="space-y-2">
            <Label>Position Sizing Method</Label>
            <Select
              value={settings.position_sizing}
              onValueChange={(value) => handleSettingChange('position_sizing', value)}
            >
              <SelectTrigger className="bg-input border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="fixed_capital">Fixed Capital per Trade</SelectItem>
                <SelectItem value="fixed_risk">Fixed Risk Percentage</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {settings.position_sizing === 'fixed_capital' ? (
            <div className="space-y-2">
              <Label>Capital per Trade (₹)</Label>
              <Input
                type="number"
                value={settings.fixed_capital_per_trade}
                onChange={(e) => handleSettingChange('fixed_capital_per_trade', parseInt(e.target.value) || 0)}
                placeholder="100000"
              />
              <p className="text-sm text-muted-foreground">
                Fixed amount of capital to deploy per trade
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Risk Percentage (%)</Label>
              <Input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={settings.risk_percent}
                onChange={(e) => handleSettingChange('risk_percent', parseFloat(e.target.value) || 1)}
                placeholder="2.0"
              />
              <p className="text-sm text-muted-foreground">
                Percentage of total capital to risk per trade
              </p>
            </div>
          )}
        </div>

        {/* Leverage */}
        <div className="space-y-2">
          <Label>Leverage Multiplier</Label>
          <Select
            value={settings.leverage.toString()}
            onValueChange={(value) => handleSettingChange('leverage', parseInt(value))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1x (No Leverage)</SelectItem>
              <SelectItem value="2">2x Leverage</SelectItem>
              <SelectItem value="3">3x Leverage</SelectItem>
              <SelectItem value="4">4x Leverage</SelectItem>
              <SelectItem value="5">5x Leverage</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Multiplier for position size (use with caution)
          </p>
        </div>

        {/* Zerodha Order Settings */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="space-y-2">
            <Label className="text-base font-medium">Zerodha Order Settings</Label>
            <p className="text-sm text-muted-foreground">
              Configure order parameters for Zerodha API
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Product Type</Label>
              <Select
                value={settings.product}
                onValueChange={(value) => handleSettingChange('product', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MIS">MIS (Intraday)</SelectItem>
                  <SelectItem value="CNC">CNC (Delivery)</SelectItem>
                  <SelectItem value="NRML">NRML (Normal)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Margin product for order execution
              </p>
            </div>

            <div className="space-y-2">
              <Label>Order Validity</Label>
              <Select
                value={settings.validity}
                onValueChange={(value) => handleSettingChange('validity', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAY">DAY (Valid till end of day)</SelectItem>
                  <SelectItem value="IOC">IOC (Immediate or Cancel)</SelectItem>
                  <SelectItem value="TTL">TTL (Time to Live)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                How long the order should remain active
              </p>
            </div>

            <div className="space-y-2">
              <Label>Market Protection (%)</Label>
              <Select
                value={settings.market_protection.toString()}
                onValueChange={(value) => handleSettingChange('market_protection', parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="-1">Auto Protection</SelectItem>
                  <SelectItem value="0">No Protection</SelectItem>
                  <SelectItem value="3">3% Protection</SelectItem>
                  <SelectItem value="5">5% Protection</SelectItem>
                  <SelectItem value="10">10% Protection</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Protection against market volatility
              </p>
            </div>

            <div className="space-y-2">
              <Label>Order Tag</Label>
              <Input
                type="text"
                maxLength={20}
                value={settings.tag || ''}
                onChange={(e) => handleSettingChange('tag', e.target.value)}
                placeholder="ALGO_TRADE"
              />
              <p className="text-sm text-muted-foreground">
                Tag to identify your algo orders (max 20 chars)
              </p>
            </div>
          </div>
        </div>

        {/* Strategy Parameters Display */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="space-y-2">
            <Label className="text-base font-medium">Strategy Parameters</Label>
            <p className="text-sm text-muted-foreground">
              These parameters are fixed in your strategy code
            </p>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">SMA Period</div>
              <div className="font-medium">50 candles</div>
            </div>
            <div>
              <div className="text-muted-foreground">Entry Offset</div>
              <div className="font-medium">₹0.01</div>
            </div>
            <div>
              <div className="text-muted-foreground">Stop Loss</div>
              <div className="font-medium">Rejection Low/High ± ₹0.01</div>
            </div>
            <div>
              <div className="text-muted-foreground">Risk:Reward</div>
              <div className="font-medium">1:5 (Based on rejection candle)</div>
            </div>
            <div>
              <div className="text-muted-foreground">Min Wick %</div>
              <div className="font-medium">15% of range</div>
            </div>
            <div>
              <div className="text-muted-foreground">Setup Candle</div>
              <div className="font-medium">Closes at 10:00:00 AM</div>
            </div>
            <div>
              <div className="text-muted-foreground">Entry Window</div>
              <div className="font-medium">10:00 AM - 12:59:59 PM</div>
            </div>
            <div>
              <div className="text-muted-foreground">Rejection Rule</div>
              <div className="font-medium">First rejection only per day</div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-3 pt-4">
          <Button
            onClick={saveSettings}
            disabled={loading || !isConnected}
            className="flex-1"
          >
            <Save className="h-4 w-4 mr-2" />
            {loading ? "Saving..." : "Save Settings"}
          </Button>
          <Button
            variant="outline"
            onClick={resetToDefaults}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
        </div>

        {!isConnected && (
          <p className="text-sm text-muted-foreground text-center">
            Connect to your broker to modify trading settings
          </p>
        )}
      </CardContent>
    </Card>
  );
}