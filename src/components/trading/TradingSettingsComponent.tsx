import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
    dry_run: true,
    fixed_capital_per_trade: 100000,
    risk_percent: 2,
    leverage: 1,
    position_sizing: 'fixed_capital',
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
      dry_run: true,
      fixed_capital_per_trade: 100000,
      risk_percent: 2,
      leverage: 1,
      position_sizing: 'fixed_capital',
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
          <span>Trading Settings</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Trading Mode */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>Paper Trading Mode</Label>
              <p className="text-sm text-muted-foreground">
                Enable for simulation without real trades
              </p>
            </div>
            <Switch
              checked={settings.dry_run}
              onCheckedChange={(checked) => handleSettingChange('dry_run', checked)}
            />
          </div>
        </div>

        {/* Position Sizing */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Position Sizing Method</Label>
            <Select
              value={settings.position_sizing}
              onValueChange={(value) => handleSettingChange('position_sizing', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
              <div className="font-medium">₹0.10</div>
            </div>
            <div>
              <div className="text-muted-foreground">Stop Loss Offset</div>
              <div className="font-medium">₹0.15</div>
            </div>
            <div>
              <div className="text-muted-foreground">Risk:Reward</div>
              <div className="font-medium">1:5</div>
            </div>
            <div>
              <div className="text-muted-foreground">Min Wick %</div>
              <div className="font-medium">15% of range</div>
            </div>
            <div>
              <div className="text-muted-foreground">Setup Time</div>
              <div className="font-medium">10:00-10:02 AM</div>
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