import { Section, Text, Request } from "../components/Notebook";

export const meta = {
  id: "test",
  title: "Test",
  description:
    "Test variable interpolation and pipe functions with httpbin.org",
};

// Notebook-specific pipe functions for testing
export const functions = {
  // Custom function for this notebook
  double: (arr) => (Array.isArray(arr) ? [...arr, ...arr] : arr),
  exclaim: (str) => String(str) + "!",
};

export default function TestNotebook() {
  return (
    <>
      <Section title="1. Basic GET Request">
        <Text>
          Test a simple GET request to httpbin.org. Save the origin IP for later
          use.
        </Text>
        <Request
          method="GET"
          path="https://httpbin.org/ip"
          description="Get your public IP address"
          saveAs={{ varName: "myIp", path: "origin" }}
        />
      </Section>

      <Section title="2. Variable Interpolation in URL">
        <Text>
          Use the saved IP in a URL parameter. Requires running step 1 first.
        </Text>
        <Request
          method="GET"
          path="https://httpbin.org/get?ip={{myIp}}"
          description="Echo back the IP as a query param"
        />
      </Section>

      <Section title="3. POST with Variable in Body">
        <Text>
          Send the IP in a POST body. Also demonstrates saving response data.
        </Text>
        <Request
          method="POST"
          path="https://httpbin.org/post"
          body={{
            savedIp: "{{myIp}}",
            message: "Hello from OpsNotebook",
          }}
          description="POST with interpolated body"
          saveAs={[
            { varName: "postHeaders", path: "headers" },
            { varName: "jsonData", path: "json" },
          ]}
        />
      </Section>

      <Section title="4. Pipe Functions - Object Functions">
        <Text>Test object pipe functions: keys, values, entries</Text>
        <Request
          method="GET"
          path="https://httpbin.org/get?keys={{postHeaders | keys | join}}"
          description="Get header keys using | keys | join"
        />
        <Request
          method="POST"
          path="https://httpbin.org/post"
          body={{
            headerKeys: "{{postHeaders | keys}}",
            firstKey: "{{postHeaders | keys | first}}",
            keyCount: "{{postHeaders | keys | length}}",
          }}
          description="Various object functions in body"
        />
      </Section>

      <Section title="5. Pipe Functions - Array Functions">
        <Text>
          Test array pipe functions: first, last, sort, reverse, unique
        </Text>
        <Request
          method="GET"
          path="https://httpbin.org/get"
          description="First, get some data to work with"
          saveAs={{ varName: "testArray", path: "args" }}
        />
        <Request
          method="POST"
          path="https://httpbin.org/post"
          body={{
            original: "{{postHeaders | keys}}",
            sorted: "{{postHeaders | keys | sort}}",
            reversed: "{{postHeaders | keys | reverse}}",
            first: "{{postHeaders | keys | first}}",
            last: "{{postHeaders | keys | last}}",
          }}
          description="Array manipulation functions"
        />
      </Section>

      <Section title="6. Pipe Functions - String Functions">
        <Text>Test string pipe functions: upper, lower, trim</Text>
        <Request
          method="POST"
          path="https://httpbin.org/post"
          body={{
            originalIp: "{{myIp}}",
            upperIp: "{{myIp | upper}}",
            lowerMessage: "{{jsonData.message | lower}}",
            trimmed: "{{jsonData.message | trim}}",
          }}
          description="String manipulation functions"
        />
      </Section>

      <Section title="7. Pipe Functions - Formatting">
        <Text>Test formatting functions: json, compact</Text>
        <Request
          method="POST"
          path="https://httpbin.org/post"
          body={{
            prettyHeaders: "{{postHeaders | json}}",
            compactHeaders: "{{postHeaders | compact}}",
          }}
          description="JSON formatting functions"
        />
      </Section>

      <Section title="8. Custom Notebook Functions">
        <Text>Test notebook-specific functions: double, exclaim</Text>
        <Request
          method="POST"
          path="https://httpbin.org/post"
          body={{
            doubledKeys: "{{postHeaders | keys | double}}",
            excitedMessage: "{{jsonData.message | exclaim}}",
          }}
          description="Custom functions defined in this notebook"
        />
      </Section>

      <Section title="9. Chained Pipe Functions">
        <Text>Test multiple pipes chained together</Text>
        <Request
          method="POST"
          path="https://httpbin.org/post"
          body={{
            chain1: "{{postHeaders | keys | sort | first | upper}}",
            chain2: "{{postHeaders | keys | reverse | first | lower}}",
            chain3: "{{postHeaders | keys | unique | length}}",
          }}
          description="Multiple pipes chained: keys | sort | first | upper"
        />
      </Section>

      <Section title="10. Nested Path Access">
        <Text>Test accessing nested paths in saved variables</Text>
        <Request
          method="POST"
          path="https://httpbin.org/post"
          body={{
            nestedMessage: "{{jsonData.message}}",
            nestedIp: "{{jsonData.savedIp}}",
          }}
          description="Access nested paths like jsonData.message"
        />
      </Section>

      <Section title="11. Shell Command Execution">
        <Text>
          Test running local shell commands. The environment variables
          TARGET_ID, TARGET_NAME, etc. are available.
        </Text>
        <Request
          target="old"
          method="EXEC"
          path='echo "Hello from $TARGET_ID ($TARGET_NAME)" && ls -l'
          description="Run echo and ls -l"
        />
        <Request
          target="old"
          method="EXEC"
          path="env | grep TARGET_"
          description="Check target environment variables"
        />
      </Section>

      <Section title="12. Saving Command Output">
        <Text>
          Demonstrates saving stdout to a variable, with optional trimming and
          parsing.
        </Text>
        <Request
          target="old"
          method="EXEC"
          path="date"
          description="Save current date (explicit stdout path)"
          saveAs={{ varName: "currentDate", path: "stdout | trim" }}
        />
        <Request
          target="old"
          method="EXEC"
          path={'echo \'{"status": "ok", "count": 42}\''}
          description="Parse JSON output from command"
          saveAs={[
            { varName: "fullJson", path: "stdout | parse" },
            { varName: "statusValue", path: "stdout | parse | status" },
          ]}
        />
        <Text>
          {
            "Verify saved variables: Date: {{currentDate}}, Status: {{statusValue}}"
          }
        </Text>
      </Section>

      <Section title="13. End-to-End Command Chain">
        <Text>
          {"Verify the full flow: execute -> save -> use in next command."}
        </Text>
        <Request
          target="old"
          method="EXEC"
          path={'echo "The saved date was: {{currentDate}}"'}
          description="Use variable from previous step in a new shell command"
        />
      </Section>
    </>
  );
}
