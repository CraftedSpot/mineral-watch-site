import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

interface MineralWatchReengagementProps {
  firstName?: string;
}

export const MineralWatchReengagement = ({
  firstName = 'there',
}: MineralWatchReengagementProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Preview>We fixed a bug and shipped major improvements to Mineral Watch</Preview>
      <Container style={container}>
        <Section style={box}>
          <Text style={logo}>MINERAL WATCH</Text>
          <Hr style={hr} />
          <Text style={paragraph}>Hi {firstName},</Text>
          <Text style={paragraph}>
            I'm James, the founder of Mineral Watch. If you had trouble adding
            properties before, it may have been related to a permissions issue
            that affected a few accounts. We've since fixed it and strengthened
            the permissions system overall.
          </Text>
          <Text style={paragraph}>
            Since then, we've made major improvements across the platform:
          </Text>
          <Text style={listItem}>
            <strong>Interactive Map</strong> — Active operators, producing
            wells, and OCC filings on an interactive map
          </Text>
          <Text style={listItem}>
            <strong>Email Digests</strong> — Weekly and daily alerts monitoring
            seven OCC filing types
          </Text>
          <Text style={listItem}>
            <strong>Document Analyzer</strong> — Upload deeds, leases, and
            pooling orders to extract decimal interest details and estimate
            revenue
          </Text>
          <Text style={listItem}>
            <strong>Pooling Benchmarks</strong> — Compare pooling terms by
            county and operator
          </Text>
          <Text style={listItem}>
            <strong>Operator Profiles</strong> — Contact info and recent
            activity for Oklahoma operators
          </Text>
          <Text style={listItem}>
            <strong>Revenue Calculator</strong> — Quick production-based revenue
            estimates for your wells
          </Text>
          <Text style={listItem}>
            <strong>Faster Imports</strong> — Cleaner dashboard navigation and
            faster property and well imports
          </Text>
          <Text style={{ ...paragraph, marginTop: '24px' }}>
            You can explore the latest features here:
          </Text>
          <Button style={button} href="https://mymineralwatch.com/features">
            See What's New
          </Button>
          <Text style={paragraph}>
            We appreciate your patience as we've continued improving the
            platform, and we'd love your feedback. If you run into any issues,
            please don't hesitate to reach out directly.
          </Text>
          <Text style={signoff}>James Price</Text>
          <Text style={signoffTitle}>Mineral Watch</Text>
          <Text style={emailLink}>
            <Link style={anchor} href="mailto:james@mymineralwatch.com">
              james@mymineralwatch.com
            </Link>
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            Mineral Watch — Automated OCC monitoring for Oklahoma mineral owners
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

export default MineralWatchReengagement;

const main = {
  backgroundColor: '#f4f4f5',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '580px',
};

const box = {
  padding: '0 48px',
};

const logo = {
  color: '#1C2B36',
  fontSize: '18px',
  fontWeight: '700' as const,
  letterSpacing: '2px',
  textAlign: 'center' as const,
  padding: '24px 0 0',
  margin: '0',
};

const hr = {
  borderColor: '#E2E8F0',
  margin: '20px 0',
};

const paragraph = {
  color: '#334E68',
  fontSize: '16px',
  lineHeight: '26px',
  textAlign: 'left' as const,
  marginBottom: '16px',
};

const listItem = {
  color: '#334E68',
  fontSize: '15px',
  lineHeight: '24px',
  textAlign: 'left' as const,
  marginBottom: '8px',
  paddingLeft: '8px',
};

const button = {
  backgroundColor: '#C05621',
  borderRadius: '4px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: '600' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  width: '100%',
  padding: '14px 0',
  marginBottom: '24px',
};

const anchor = {
  color: '#C05621',
};

const signoff = {
  color: '#1C2B36',
  fontSize: '16px',
  fontWeight: '600' as const,
  lineHeight: '20px',
  marginBottom: '0',
};

const signoffTitle = {
  color: '#718096',
  fontSize: '14px',
  lineHeight: '18px',
  marginTop: '4px',
  marginBottom: '0',
};

const emailLink = {
  fontSize: '14px',
  lineHeight: '18px',
  marginTop: '4px',
  marginBottom: '0',
};

const footer = {
  color: '#A0AEC0',
  fontSize: '12px',
  lineHeight: '16px',
  textAlign: 'center' as const,
};
