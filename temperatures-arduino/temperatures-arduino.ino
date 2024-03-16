/*
/* Grove - Temperature Sensor demo v1.0
*  This sensor detects the environment temperature,
*  Connect the signal of this sensor to A0, use the 
*  Serial monitor to get the result.
*  By: http://www.seeedstudio.com
*/
#include <math.h>
int a;
float temperature;
float moisture;
int B=3975;                  //B value of the thermistor
float resistance;
<<<<<<< Updated upstream
char *portNames[] = {"\"sensor1\":", "\"sensor2\":", "\"sensor3\":"};
=======
char *portNames[] = {"\"sensor1\":", "\"sensor2\":"};
>>>>>>> Stashed changes
char *moisturePortName = "\"m\":";
int numPortNames;
 
void setup()
{
  Serial.begin(9600);
  numPortNames = sizeof(portNames) / sizeof(portNames[0]);
}
 
void loop()
{
  String buf;
  buf += "[";
  for (int i = 0; i < numPortNames; ++i)
  {
    a=analogRead(i);
    resistance=(float)(1023-a)*10000/a; //get the resistance of the sensor;
    temperature=1/(log(resistance/10000)/B+1/298.15)-273.15;//convert to temperature via datasheet&nbsp;;
    temperature = (temperature*1.8)+32;
    buf += "{";
    buf += portNames[i];
    buf += String(temperature, 6);
    buf += "}";
    if (i < numPortNames - 1)
    {
      buf += ",";
    }
  }

<<<<<<< Updated upstream
  a=analogRead(3);
=======
  a=analogRead(numPortNames);
>>>>>>> Stashed changes
  buf += ",{";
  buf += moisturePortName;
  buf += String(a, 6);
  buf += "}";
<<<<<<< Updated upstream
  
=======

>>>>>>> Stashed changes
  buf += "]";
  Serial.println(buf);
  delay(60000);
 }
