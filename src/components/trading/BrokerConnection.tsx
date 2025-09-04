import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wifi, WifiOff, LogIn, User, AlertCircle, CheckCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { tradingApi } from "@/services/trading-api";
import { useToast } from "@/hooks/use-toast";

interface BrokerConnectionProps {
  isConnected: boolean;
  onConnectionChange: (connected: boolean, userData?: any) => void;
}

export function BrokerConnection({ isConnected, onConnectionChange }: BrokerConnectionProps) {
  const [loading, setLoading] = useState(false);
  const [requestToken, setRequestToken] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [userInfo, setUserInfo] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const response = await tradingApi.testConnection();
      if (response.status === 'success' && response.data) {
        setUserInfo(response.data);
        onConnectionChange(true, response.data);
      } else {
        onConnectionChange(false);
      }
    } catch (error) {
      console.error('Connection check failed:', error);
      onConnectionChange(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    try {
      const response = await tradingApi.login(requestToken);
      
      if (response.status === 'success' && response.data) {
        setUserInfo(response.data);
        onConnectionChange(true, response.data);
        setRequestToken("");
        setLoginUrl("");
        toast({
          title: "Connected Successfully",
          description: `Welcome ${response.data.user_id}`,
        });
      } else if (response.status === 'requires_login' && response.login_url) {
        setLoginUrl(response.login_url);
        toast({
          title: "Login Required",
          description: "Please complete login and enter the request token.",
        });
      } else {
        toast({
          title: "Login Failed",
          description: response.message || "Unknown error occurred",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to connect to trading platform",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const openLoginPage = () => {
    if (loginUrl) {
      window.open(loginUrl, '_blank');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          {isConnected ? (
            <>
              <Wifi className="h-5 w-5 text-success" />
              <span>Broker Connection</span>
            </>
          ) : (
            <>
              <WifiOff className="h-5 w-5 text-destructive" />
              <span>Connect to Broker</span>
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <StatusBadge variant="success">
                <CheckCircle className="h-3 w-3 mr-1" />
                Connected
              </StatusBadge>
              <Button variant="outline" size="sm" onClick={checkConnection}>
                Refresh
              </Button>
            </div>
            
            {userInfo && (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    <span className="text-muted-foreground">User ID:</span>
                    <span className="font-medium ml-1">{userInfo.user_id}</span>
                  </span>
                </div>
                {userInfo.user_name && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-medium ml-1">{userInfo.user_name}</span>
                  </div>
                )}
              </div>
            )}

            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                Ready for live trading. All API calls will be executed on your connected account.
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="space-y-4">
            {!loginUrl ? (
              <Button
                onClick={handleLogin}
                disabled={loading}
                className="w-full"
              >
                <LogIn className="h-4 w-4 mr-2" />
                {loading ? "Connecting..." : "Connect to Zerodha"}
              </Button>
            ) : (
              <div className="space-y-3">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Complete login on Zerodha and copy the request token from the redirect URL.
                  </AlertDescription>
                </Alert>

                <Button
                  onClick={openLoginPage}
                  variant="outline"
                  className="w-full"
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  Open Zerodha Login
                </Button>

                <div className="space-y-2">
                  <Label htmlFor="request_token">Request Token</Label>
                  <Input
                    id="request_token"
                    placeholder="Enter request token from redirect URL"
                    value={requestToken}
                    onChange={(e) => setRequestToken(e.target.value)}
                  />
                </div>

                <Button
                  onClick={handleLogin}
                  disabled={loading || !requestToken.trim()}
                  className="w-full"
                >
                  {loading ? "Connecting..." : "Complete Connection"}
                </Button>
              </div>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Connect to your Zerodha account to enable live trading. 
                Your credentials are secure and handled directly by Zerodha's API.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  );
}