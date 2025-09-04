import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Key, Eye, EyeOff, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface CredentialsSetupProps {
  onCredentialsSet: () => void;
}

export function CredentialsSetup({ onCredentialsSet }: CredentialsSetupProps) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast({
        title: "Missing Credentials",
        description: "Please enter both API key and secret",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("http://127.0.0.1:8000/api/set_credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: apiKey,
          api_secret: apiSecret,
        }),
      });

      const data = await response.json();
      
      if (data.status === "success") {
        toast({
          title: "Credentials Set",
          description: "API credentials have been configured successfully",
        });
        onCredentialsSet();
      } else {
        toast({
          title: "Error",
          description: data.message || "Failed to set credentials",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to connect to backend server",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Key className="h-5 w-5" />
          <span>Zerodha API Setup</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <ExternalLink className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p>Get your API credentials from Zerodha Console:</p>
              <a 
                href="https://kite.trade" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                https://kite.trade
              </a>
              <p className="text-xs text-muted-foreground">
                You'll need to create an app and get the API key and secret
              </p>
            </div>
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="api_key">API Key</Label>
            <Input
              id="api_key"
              type="text"
              placeholder="Enter your Zerodha API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="api_secret">API Secret</Label>
            <div className="relative">
              <Input
                id="api_secret"
                type={showSecret ? "text" : "password"}
                placeholder="Enter your Zerodha API secret"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                className="font-mono pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowSecret(!showSecret)}
              >
                {showSecret ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={loading || !apiKey.trim() || !apiSecret.trim()}
            className="w-full"
          >
            {loading ? "Setting up..." : "Set API Credentials"}
          </Button>
        </div>

        <Alert>
          <AlertDescription>
            <div className="space-y-1">
              <p className="font-medium">Security Notes:</p>
              <p className="text-xs text-muted-foreground">
                • Credentials are stored temporarily in the backend session<br/>
                • For production, use environment variables or config files<br/>
                • Never share your API credentials with anyone<br/>
                • You can revoke access anytime from Zerodha Console
              </p>
            </div>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}